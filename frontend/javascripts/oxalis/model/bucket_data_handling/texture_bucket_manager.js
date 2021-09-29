// @flow
import * as THREE from "three";
import _ from "lodash";

import { DataBucket, bucketDebuggingFlags } from "oxalis/model/bucket_data_handling/bucket";
import { createUpdatableTexture } from "oxalis/geometries/materials/plane_material_factory_helpers";
import {
  getAddressSpaceDimensions,
  getBucketCapacity,
  getLookupBufferSize,
  getPackingDegree,
  getChannelCount,
} from "oxalis/model/bucket_data_handling/data_rendering_logic";
import { getBaseBucketsForFallbackBucket } from "oxalis/model/helpers/position_converter";
import { getMaxZoomStepDiff } from "oxalis/model/bucket_data_handling/loading_strategy_logic";
import { getRenderer } from "oxalis/controller/renderer";
import { getResolutions } from "oxalis/model/accessors/dataset_accessor";
import { waitForCondition } from "libs/utils";
import Store from "oxalis/store";
import UpdatableTexture from "libs/UpdatableTexture";
import constants, { type Vector3, type Vector4 } from "oxalis/constants";
import window from "libs/window";
import type { ElementClass } from "types/api_flow_types";

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

// At the moment, we only store one float f per bucket.
// If f >= 0, f denotes the index in the data texture where the bucket is stored.
// If f == -1, the bucket is not yet committed
// If f == -2, the bucket is not supposed to be rendered. Out of bounds.
export const channelCountForLookupBuffer = 2;

function getSomeValue<T>(set: Set<T>): T {
  const { value } = set.values().next();

  if (value == null) {
    throw new Error("Cannot get value of set because it's empty.");
  }

  return value;
}

export default class TextureBucketManager {
  dataTextures: Array<typeof UpdatableTexture>;
  lookUpBuffer: Float32Array;
  lookUpTexture: typeof THREE.DataTexture;
  // Holds the index for each active bucket, to which it should (or already
  // has been was) written in the data texture.
  activeBucketToIndexMap: Map<DataBucket, number> = new Map();
  // Maintains the set of committed buckets
  committedBucketSet: WeakSet<DataBucket> = new WeakSet();
  // Maintains a set of free indices within the data texture.
  freeIndexSet: Set<number>;
  isRefreshBufferOutOfDate: boolean = false;

  currentAnchorPoint: Vector4 = [0, 0, 0, 0];
  writerQueue: Array<{ bucket: DataBucket, _index: number }> = [];
  textureWidth: number;
  dataTextureCount: number;
  maximumCapacity: number;
  packingDegree: number;
  addressSpaceDimensions: Vector3;
  lookUpBufferWidth: number;
  elementClass: ElementClass;

  constructor(
    textureWidth: number,
    dataTextureCount: number,
    bytes: number,
    elementClass: ElementClass,
  ) {
    // If there is one byte per voxel, we pack 4 bytes into one texel (packingDegree = 4)
    // Otherwise, we don't pack bytes together (packingDegree = 1)
    this.packingDegree = getPackingDegree(bytes, elementClass);
    this.elementClass = elementClass;
    this.maximumCapacity = getBucketCapacity(dataTextureCount, textureWidth, this.packingDegree);

    const { initializedGpuFactor } = Store.getState().temporaryConfiguration.gpuSetup;
    this.addressSpaceDimensions = getAddressSpaceDimensions(initializedGpuFactor);
    this.lookUpBufferWidth = getLookupBufferSize(initializedGpuFactor);

    // the look up buffer is addressSpaceDimensions**3 so that arbitrary look ups can be made
    const lookUpBufferSize = Math.pow(this.lookUpBufferWidth, 2) * channelCountForLookupBuffer;
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
    this.setActiveBuckets([], [0, 0, 0, 0], false);
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

  setAnchorPoint(anchorPoint: Vector4): void {
    this.currentAnchorPoint = anchorPoint;
    this._refreshLookUpBuffer();
  }

  // Takes an array of buckets (relative to an anchorPoint) and ensures that these
  // are written to the dataTexture. The lookUpTexture will be updated to reflect the
  // new buckets.
  setActiveBuckets(
    buckets: Array<DataBucket>,
    anchorPoint: Vector4,
    isAnchorPointNew: boolean,
  ): void {
    this.currentAnchorPoint = anchorPoint;
    window.currentAnchorPoint = anchorPoint;
    // Find out which buckets are not needed anymore
    const freeBucketSet = new Set(this.activeBucketToIndexMap.keys());
    for (const bucket of buckets) {
      freeBucketSet.delete(bucket);
    }

    // Remove unused buckets
    for (const freeBucket of freeBucketSet.values()) {
      this.freeBucket(freeBucket);
    }

    let needsNewBucket = false;

    for (const nextBucket of buckets) {
      if (!this.activeBucketToIndexMap.has(nextBucket)) {
        if (this.freeIndexSet.size === 0) {
          throw new Error("A new bucket should be stored but there is no space for it?");
        }
        const freeBucketIdx = getSomeValue(this.freeIndexSet);
        this.reserveIndexForBucket(nextBucket, freeBucketIdx);
        needsNewBucket = true;
      }
    }

    // The lookup buffer only needs to be refreshed if some previously active buckets are no longer needed
    // or if new buckets are needed or if the anchorPoint changed. Otherwise we may end up in an endless loop.
    if (freeBucketSet.size > 0 || needsNewBucket || isAnchorPointNew) {
      this._refreshLookUpBuffer();
    }
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
      if (bucket.data == null) {
        // The bucket is not available anymore (was collected
        // and not yet removed from the queue). Ignore it.
        console.warn("Skipping unavailable bucket in TextureBucketManager.");
        continue;
      }

      if (bucketDebuggingFlags.visualizeBucketsOnGPU) {
        bucket.visualize();
      }

      const dataTextureIndex = Math.floor(_index / bucketsPerTexture);
      const indexInDataTexture = _index % bucketsPerTexture;
      const data = bucket.getData();
      const TypedArrayClass = this.elementClass === "float" ? Float32Array : Uint8Array;
      this.dataTextures[dataTextureIndex].update(
        new TypedArrayClass(
          data.buffer,
          data.byteOffset,
          data.byteLength / TypedArrayClass.BYTES_PER_ELEMENT,
        ),
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

  getTextures(): Array<typeof THREE.DataTexture | typeof UpdatableTexture> {
    return [this.lookUpTexture].concat(this.dataTextures);
  }

  setupDataTextures(bytes: number): void {
    for (let i = 0; i < this.dataTextureCount; i++) {
      const channelCount = getChannelCount(bytes, this.packingDegree, this.elementClass);
      const textureType = this.elementClass === "float" ? THREE.FloatType : THREE.UnsignedByteType;
      const dataTexture = createUpdatableTexture(
        this.textureWidth,
        channelCount,
        textureType,
        getRenderer(),
      );

      this.dataTextures.push(dataTexture);
    }

    const lookUpTexture = createUpdatableTexture(
      this.lookUpBufferWidth,
      channelCountForLookupBuffer,
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

    let unlistenToLoadedFn = _.noop;
    let unlistenToLabeledFn = _.noop;

    const updateBucketData = () => {
      // Check that the bucket is still in the data texture.
      // Also the index could have changed, so retrieve the index again.
      const bucketIndex = this.activeBucketToIndexMap.get(bucket);
      if (bucketIndex != null) {
        enqueueBucket(bucketIndex);
      } else {
        unlistenToLabeledFn();
      }
    };

    if (!bucket.hasData()) {
      unlistenToLoadedFn = bucket.on("bucketLoaded", updateBucketData);
    }
    unlistenToLabeledFn = bucket.on("bucketLabeled", updateBucketData);
    bucket.once("bucketCollected", () => {
      unlistenToLoadedFn();
      unlistenToLabeledFn();
      this.freeBucket(bucket);
    });
  }

  _refreshLookUpBuffer() {
    /* This method completely completely re-writes the lookup buffer.
     * It works as follows:
     * - write -2 into the entire buffer as a fallback
     * - iterate over all buckets
     *   - if the current bucket is in the current zoomStep ("isBaseBucket"), either
     *     - write the target address to the look up buffer if the bucket was committed
     *     - otherwise: write a fallback bucket to the look up buffer
     *   - else if the current bucket is a fallback bucket, write the address for that bucket into all
     *     the positions of the look up buffer which map to that fallback bucket (in an isotropic case, that's 8
     *     positions). Only do this if the bucket belongs to the first fallback layer. Otherwise, the complexity
           would be too high, due to the exponential combinations.
     */

    this.lookUpBuffer.fill(-2);
    const maxZoomStepDiff = getMaxZoomStepDiff(
      Store.getState().datasetConfiguration.loadingStrategy,
    );

    const currentZoomStep = this.currentAnchorPoint[3];
    for (const [bucket, reservedAddress] of this.activeBucketToIndexMap.entries()) {
      let address = -1;
      let bucketZoomStep = bucket.zoomedAddress[3];
      if (!bucketDebuggingFlags.enforcedZoomDiff && this.committedBucketSet.has(bucket)) {
        address = reservedAddress;
      }

      const zoomStepDifference = bucketZoomStep - currentZoomStep;
      const isBaseBucket = zoomStepDifference === 0;
      if (isBaseBucket) {
        if (address === -1) {
          let fallbackBucket = bucket.getFallbackBucket();
          let abortFallbackLoop = false;
          const maxAllowedZoomStep =
            currentZoomStep + (bucketDebuggingFlags.enforcedZoomDiff || maxZoomStepDiff);
          while (!abortFallbackLoop) {
            if (fallbackBucket.type !== "null") {
              if (
                fallbackBucket.zoomedAddress[3] <= maxAllowedZoomStep &&
                this.committedBucketSet.has(fallbackBucket)
              ) {
                address = this.activeBucketToIndexMap.get(fallbackBucket);
                address = address != null ? address : -1;
                bucketZoomStep = fallbackBucket.zoomedAddress[3];
                abortFallbackLoop = true;
              } else {
                // Try next fallback bucket
                fallbackBucket = fallbackBucket.getFallbackBucket();
              }
            } else {
              abortFallbackLoop = true;
            }
          }
        }

        const lookUpIdx = this._getBucketIndex(bucket.zoomedAddress);
        if (lookUpIdx !== -1) {
          const posInBuffer = channelCountForLookupBuffer * lookUpIdx;
          this.lookUpBuffer[posInBuffer] = address;
          this.lookUpBuffer[posInBuffer + 1] = bucketZoomStep;
        }
      } else if (address !== -1) {
        const baseBucketAddresses = this._getBaseBucketAddresses(
          bucket,
          zoomStepDifference,
          maxZoomStepDiff,
        );
        for (const baseBucketAddress of baseBucketAddresses) {
          const lookUpIdx = this._getBucketIndex(baseBucketAddress);
          const posInBuffer = channelCountForLookupBuffer * lookUpIdx;
          if (this.lookUpBuffer[posInBuffer] !== -2 || lookUpIdx === -1) {
            // Either, another bucket was already placed here. Or, the lookUpIdx is
            // invalid. Skip the entire loop
            break;
          }
          this.lookUpBuffer[posInBuffer] = address;
          this.lookUpBuffer[posInBuffer + 1] = bucketZoomStep;
        }
      } else {
        // Don't overwrite the default -2 within the look up buffer for fallback buckets,
        // since the effort is not worth it (only has an impact on the fallback color within the shader)
      }
    }

    this.lookUpTexture.update(
      this.lookUpBuffer,
      0,
      0,
      this.lookUpBufferWidth,
      this.lookUpBufferWidth,
    );
    this.isRefreshBufferOutOfDate = false;
    window.needsRerender = true;
  }

  _getBucketIndex(bucketPosition: Vector4): number {
    const anchorPoint = this.currentAnchorPoint;

    const x = bucketPosition[0] - anchorPoint[0];
    const y = bucketPosition[1] - anchorPoint[1];
    const z = bucketPosition[2] - anchorPoint[2];

    const [xMax, yMax, zMax] = this.addressSpaceDimensions;

    if (x > xMax || y > yMax || z > zMax || x < 0 || y < 0 || z < 0) {
      // The bucket is outside of the addressable space.
      return -1;
    }

    // prettier-ignore
    return (
      xMax * yMax * z +
      xMax * y +
      x
    );
  }

  _getBaseBucketAddresses(
    bucket: DataBucket,
    zoomStepDifference: number,
    maxZoomStepDifference: number,
  ): Array<Vector4> {
    if (zoomStepDifference > maxZoomStepDifference) return [];

    const resolutions = getResolutions(Store.getState().dataset);
    return getBaseBucketsForFallbackBucket(bucket.zoomedAddress, zoomStepDifference, resolutions);
  }
}
