// @flow
import * as THREE from "three";
import _ from "lodash";

import { DataBucket, bucketDebuggingFlags } from "oxalis/model/bucket_data_handling/bucket";
import { createUpdatableTexture } from "oxalis/geometries/materials/abstract_plane_material_factory";
import { getRenderer } from "oxalis/controller/renderer";
import { waitForCondition } from "libs/utils";
import UpdatableTexture from "libs/UpdatableTexture";
import constants, { type Vector3, type Vector4 } from "oxalis/constants";
import window from "libs/window";

// A TextureBucketManager instance is responsible for making buckets available
// to the GPU.
// setActiveBuckets can be called with an array of buckets, which will be
// written into the dataTexture and lookUpTexture of this class instance.
// Buckets which are already in this texture won't be written again.
// Buckets which are not needed anymore will be replaced by other buckets.

// A bucket is considered "active" if it is supposed to be in the data texture.
// A bucket is considered "committed" if it is indeed in the data texture.
// Active buckets will be pushed into a writerQueue which is processed by
// writing buckets to the data texture (i.e., "committing the buckets").

const lookUpBufferWidth = constants.LOOK_UP_TEXTURE_WIDTH;

// At the moment, we only store one float f per bucket.
// If f >= 0, f denotes the index in the data texture where the bucket is stored.
// If f == -1, the bucket is not yet committed
// If f == -2, the bucket is not supposed to be rendered. Out of bounds.
export const floatsPerLookUpEntry = 1;

export default class TextureBucketManager {
  dataTextures: Array<UpdatableTexture>;
  lookUpBuffer: Float32Array;
  lookUpTexture: THREE.DataTexture;
  // Holds the index for each active bucket, to which it should (or already
  // has been was) written in the data texture.
  activeBucketToIndexMap: Map<DataBucket, number> = new Map();
  // Maintains the set of committed buckets
  committedBucketSet: WeakSet<DataBucket> = new WeakSet();
  // Maintains a set of free indices within the data texture.
  freeIndexSet: Set<number>;
  isRefreshBufferOutOfDate: boolean = false;

  // This is passed as a parameter to allow for testing
  bucketsPerDimPerResolution: Array<Vector3>;
  currentAnchorPoint: Vector4 = [0, 0, 0, 0];
  fallbackAnchorPoint: Vector4 = [0, 0, 0, 0];
  writerQueue: Array<{ bucket: DataBucket, _index: number }> = [];
  textureWidth: number;
  dataTextureCount: number;
  maximumCapacity: number;
  packingDegree: number;

  constructor(
    bucketsPerDimPerResolution: Array<Vector3>,
    textureWidth: number,
    dataTextureCount: number,
    bytes: number,
  ) {
    // If there is one byte per voxel, we pack 4 bytes into one texel (packingDegree = 4)
    // Otherwise, we don't pack bytes together (packingDegree = 1)
    this.packingDegree = bytes === 1 ? 4 : 1;

    this.maximumCapacity =
      (this.packingDegree * dataTextureCount * textureWidth ** 2) / constants.BUCKET_SIZE;
    // the look up buffer is bucketsPerDim**3 so that arbitrary look ups can be made
    const lookUpBufferSize = Math.pow(lookUpBufferWidth, 2) * floatsPerLookUpEntry;
    this.bucketsPerDimPerResolution = bucketsPerDimPerResolution;
    this.textureWidth = textureWidth;
    this.dataTextureCount = dataTextureCount;

    this.lookUpBuffer = new Float32Array(lookUpBufferSize);
    this.freeIndexSet = new Set(_.range(this.maximumCapacity));

    this.dataTextures = [];
  }

  async startRAFLoops() {
    await waitForCondition(
      () => this.lookUpTexture.isInitialized() && this.dataTextures[0].isInitialized(),
    );

    this.keepLookUpBufferUpToDate();
    this.processWriterQueue();
  }

  clear() {
    this.setActiveBuckets([], [0, 0, 0, 0], [0, 0, 0, 0]);
  }

  freeBucket(bucket: DataBucket): void {
    const unusedIndex = this.activeBucketToIndexMap.get(bucket);
    if (unusedIndex == null) {
      return;
    }
    if (bucketDebuggingFlags.visualizeBucketsOnGPU) {
      bucket.unvisualize();
    }
    this.activeBucketToIndexMap.delete(bucket);
    this.committedBucketSet.delete(bucket);
    this.freeIndexSet.add(unusedIndex);
  }

  // Takes an array of buckets (relative to an anchorPoint) and ensures that these
  // are written to the dataTexture. The lookUpTexture will be updated to reflect the
  // new buckets.
  setActiveBuckets(
    buckets: Array<DataBucket>,
    anchorPoint: Vector4,
    fallbackAnchorPoint: Vector4,
  ): void {
    this.currentAnchorPoint = anchorPoint;
    window.currentAnchorPoint = anchorPoint;
    this.fallbackAnchorPoint = fallbackAnchorPoint;
    // Find out which buckets are not needed anymore
    const freeBucketSet = new Set(this.activeBucketToIndexMap.keys());
    for (const bucket of buckets) {
      freeBucketSet.delete(bucket);
    }

    // Remove unused buckets
    const freeBuckets = Array.from(freeBucketSet.values());
    for (const freeBucket of freeBuckets) {
      this.freeBucket(freeBucket);
    }

    const freeIndexArray = Array.from(this.freeIndexSet);
    for (const nextBucket of buckets) {
      if (!this.activeBucketToIndexMap.has(nextBucket)) {
        if (freeIndexArray.length === 0) {
          throw new Error("A new bucket should be stored but there is no space for it?");
        }
        const freeBucketIdx = freeIndexArray.shift();
        this.reserveIndexForBucket(nextBucket, freeBucketIdx);
      }
    }

    this._refreshLookUpBuffer();
  }

  getPackedBucketSize() {
    return constants.BUCKET_SIZE / this.packingDegree;
  }

  keepLookUpBufferUpToDate() {
    if (this.isRefreshBufferOutOfDate) {
      this._refreshLookUpBuffer();
    }
    window.requestAnimationFrame(() => {
      this.keepLookUpBufferUpToDate();
    });
  }

  // Commit "active" buckets by writing these to the dataTexture.
  processWriterQueue() {
    // uniqBy removes multiple write-buckets-requests for the same index.
    // It preserves the first occurence of each duplicate, which is why
    // this queue has to be filled from the front (via unshift) und read from the
    // back (via pop). This ensures that the newest bucket "wins" if there are
    // multiple buckets for the same index.
    this.writerQueue = _.uniqBy(this.writerQueue, el => el._index);
    const maxTimePerFrame = 16;
    const startingTime = performance.now();

    const packedBucketSize = this.getPackedBucketSize();
    const bucketHeightInTexture = packedBucketSize / this.textureWidth;
    const bucketsPerTexture = (this.textureWidth * this.textureWidth) / packedBucketSize;

    while (performance.now() - startingTime < maxTimePerFrame && this.writerQueue.length > 0) {
      const { bucket, _index } = this.writerQueue.pop();
      if (!this.activeBucketToIndexMap.has(bucket)) {
        // This bucket is not needed anymore
        continue;
      }

      const dataTextureIndex = Math.floor(_index / bucketsPerTexture);
      const indexInDataTexture = _index % bucketsPerTexture;

      if (bucketDebuggingFlags.visualizeBucketsOnGPU) {
        bucket.visualize();
      }

      this.dataTextures[dataTextureIndex].update(
        bucket.getData(),
        0,
        bucketHeightInTexture * indexInDataTexture,
        this.textureWidth,
        bucketHeightInTexture,
      );
      this.committedBucketSet.add(bucket);
      // bucket.setVisualizationColor("#00ff00");
      // bucket.visualize();

      window.needsRerender = true;
      this.isRefreshBufferOutOfDate = true;
    }

    window.requestAnimationFrame(() => {
      this.processWriterQueue();
    });
  }

  getTextures(): Array<THREE.DataTexture | UpdatableTexture> {
    return [this.lookUpTexture].concat(this.dataTextures);
  }

  setupDataTextures(bytes: number): void {
    for (let i = 0; i < this.dataTextureCount; i++) {
      const dataTexture = createUpdatableTexture(
        this.textureWidth,
        bytes * this.packingDegree,
        THREE.UnsignedByteType,
        getRenderer(),
      );

      this.dataTextures.push(dataTexture);
    }

    const lookUpTexture = createUpdatableTexture(
      lookUpBufferWidth,
      1,
      THREE.FloatType,
      getRenderer(),
    );
    this.lookUpTexture = lookUpTexture;

    this.startRAFLoops();
  }

  getLookUpBuffer() {
    return this.lookUpBuffer;
  }

  // Assign an index to an active bucket and enqueue the bucket-index-tuple
  // to the writerQueue. Also, make sure that the bucket data is updated if
  // it changes.
  reserveIndexForBucket(bucket: DataBucket, index: number): void {
    this.freeIndexSet.delete(index);
    this.activeBucketToIndexMap.set(bucket, index);

    const enqueueBucket = _index => {
      if (!bucket.hasData()) {
        return;
      }
      this.writerQueue.unshift({ bucket, _index });
    };
    enqueueBucket(index);

    let debouncedUpdateBucketData;
    const updateBucketData = () => {
      // Check that the bucket is still in the data texture.
      // Also the index could have changed, so retrieve the index again.
      const bucketIndex = this.activeBucketToIndexMap.get(bucket);
      if (bucketIndex != null) {
        enqueueBucket(bucketIndex);
      } else {
        bucket.off("bucketLabeled", debouncedUpdateBucketData);
      }
    };

    if (!bucket.hasData()) {
      bucket.on("bucketLoaded", updateBucketData);
    }
    bucket.on("bucketLabeled", updateBucketData);
    bucket.once("bucketCollected", () => {
      bucket.off("bucketLabeled", updateBucketData);
      bucket.off("bucketLoaded", updateBucketData);
      this.freeBucket(bucket);
    });
  }

  _refreshLookUpBuffer() {
    // Completely re-write the lookup buffer. This could be smarter, but it's
    // probably not worth it.
    this.lookUpBuffer.fill(-2);
    for (const [bucket, address] of this.activeBucketToIndexMap.entries()) {
      const lookUpIdx = this._getBucketIndex(bucket);
      this.lookUpBuffer[floatsPerLookUpEntry * lookUpIdx] = this.committedBucketSet.has(bucket)
        ? address
        : -1;
    }

    this.lookUpTexture.update(this.lookUpBuffer, 0, 0, lookUpBufferWidth, lookUpBufferWidth);
    this.isRefreshBufferOutOfDate = false;
    window.needsRerender = true;
  }

  _getBucketIndex(bucket: DataBucket): number {
    const bucketPosition = bucket.zoomedAddress;
    const renderingZoomStep = this.currentAnchorPoint[3];
    const bucketZoomStep = bucketPosition[3];
    const zoomDiff = bucketZoomStep - renderingZoomStep;
    const isFallbackBucket = zoomDiff > 0;

    const anchorPoint = isFallbackBucket ? this.fallbackAnchorPoint : this.currentAnchorPoint;

    const x = bucketPosition[0] - anchorPoint[0];
    const y = bucketPosition[1] - anchorPoint[1];
    const z = bucketPosition[2] - anchorPoint[2];

    if (x < 0) console.warn("x should be greater than 0. is currently:", x);
    if (y < 0) console.warn("y should be greater than 0. is currently:", y);
    if (z < 0) console.warn("z should be greater than 0. is currently:", z);

    // Even though, bucketsPerDim might be different in the fallback case,
    // it's save to assume that the values would only be smaller (since
    // fallback data doesn't require more buckets than non-fallback).
    // Consequently, these values should be fine to address buckets.
    const [sx, sy, sz] = this.bucketsPerDimPerResolution[renderingZoomStep];

    // prettier-ignore
    return (
      sx * sy * sz * zoomDiff +
      sx * sy * z +
      sx * y +
      x
    );
  }
}
