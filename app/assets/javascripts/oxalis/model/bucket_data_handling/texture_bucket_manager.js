// @flow
import { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import type { Vector4 } from "oxalis/constants";
import constants from "oxalis/constants";
import _ from "lodash";
import * as THREE from "three";
import UpdatableTexture from "libs/UpdatableTexture";
import window from "libs/window";
import { createUpdatableTexture } from "oxalis/geometries/materials/abstract_plane_material_factory";
import { getRenderer } from "oxalis/controller/renderer";

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
  bucketsPerDim: number;
  currentAnchorPoint: Vector4 = [0, 0, 0, 0];
  fallbackAnchorPoint: Vector4 = [0, 0, 0, 0];
  writerQueue: Array<{ bucket: DataBucket, _index: number }> = [];
  textureWidth: number;
  dataTextureCount: number;
  maximumCapacity: number;
  packingDegree: number;

  constructor(
    bucketsPerDim: number,
    textureWidth: number,
    dataTextureCount: number,
    bytes: number,
  ) {
    // If there is one byte per voxel, we pack 4 bytes into one texel (packingDegree = 4)
    // Otherwise, we don't pack bytes together (packingDegree = 1)
    this.packingDegree = bytes === 1 ? 4 : 1;

    this.maximumCapacity =
      this.packingDegree * dataTextureCount * textureWidth ** 2 / constants.BUCKET_SIZE;
    // the look up buffer is bucketsPerDim**3 so that arbitrary look ups can be made
    const lookUpBufferSize = Math.pow(lookUpBufferWidth, 2) * floatsPerLookUpEntry;
    this.bucketsPerDim = bucketsPerDim;
    this.textureWidth = textureWidth;
    this.dataTextureCount = dataTextureCount;

    this.lookUpBuffer = new Float32Array(lookUpBufferSize);
    this.freeIndexSet = new Set(_.range(this.maximumCapacity));

    this.dataTextures = [];

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
    const bucketsPerTexture = this.textureWidth * this.textureWidth / packedBucketSize;

    while (performance.now() - startingTime < maxTimePerFrame && this.writerQueue.length > 0) {
      const { bucket, _index } = this.writerQueue.pop();
      if (!this.activeBucketToIndexMap.has(bucket)) {
        // This bucket is not needed anymore
        continue;
      }

      const dataTextureIndex = Math.floor(_index / bucketsPerTexture);
      const indexInDataTexture = _index % bucketsPerTexture;

      this.dataTextures[dataTextureIndex].update(
        bucket.getData(),
        0,
        bucketHeightInTexture * indexInDataTexture,
        this.textureWidth,
        bucketHeightInTexture,
      );
      this.committedBucketSet.add(bucket);
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
      // Since activeBucketToIndexMap is a super set of committedBucketSet,
      // address is always defined ($FlowFixMe).

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
    const zoomDiff = bucketPosition[3] - this.currentAnchorPoint[3];
    const isFallbackBucket = zoomDiff > 0;

    const anchorPoint = isFallbackBucket ? this.fallbackAnchorPoint : this.currentAnchorPoint;

    const x = bucketPosition[0] - anchorPoint[0];
    const y = bucketPosition[1] - anchorPoint[1];
    const z = bucketPosition[2] - anchorPoint[2];

    return (
      Math.pow(this.bucketsPerDim, 3) * zoomDiff +
      Math.pow(this.bucketsPerDim, 2) * z +
      this.bucketsPerDim * y +
      x
    );
  }
}
