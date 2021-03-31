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
  const value = set.values().next().value;

  if (value == null) {
    throw new Error("Cannot get value of set because it's empty.");
  }

  return value;
}

const entriesPerKey = 5;
const tableCount = 2;
export class CuckooTable {
  constructor() {
    this.capacity = 4096;
    this.table = new Uint16Array(entriesPerKey * this.capacity * tableCount);
    this.seed1 = 17;
    this.seed2 = 21;
  }

  setEntry(key: Vector4, value: number) {
    const hashedAddress1 = this._hashKey(this.seed1, key, 0);
    const hashedAddress2 = this._hashKey(this.seed2, key, 1);

    // if (this.hasEntry(key, value, hashedAddress1, hashedAddress2)) {
    //   return;
    // }

    let entryToWrite = [key[0], key[1], key[2], key[3], value];

    if (this.isAddressValidForKey(key, hashedAddress1)) {
      console.log("Writing", entryToWrite, "in table 1:", hashedAddress1);
      this.writeEntryAtAddress(entryToWrite, hashedAddress1);
      return;
    } else {
      console.log("Table 1 is already occupied at", hashedAddress1);
    }

    if (this.isAddressValidForKey(key, hashedAddress2)) {
      console.log("Writing", entryToWrite, "in table 2:", hashedAddress2);
      this.writeEntryAtAddress(entryToWrite, hashedAddress2);
      return;
    } else {
      console.log("Table 2 is already occupied at", hashedAddress2);
    }

    let displacedEntry;
    let currentAddress = hashedAddress1;

    let iterationCounter = 0;
    const ITERATION_THRESHOLD = 10;
    while (iterationCounter++ < ITERATION_THRESHOLD) {
      // x↔T1[h1(key[x])] // tausche x mit Pos. in T1
      // if x=NIL then return
      // x↔T2[h2(key[x])] // tausche x mit Pos. in T2
      // if x=NIL then return

      console.log("Try to evict at", currentAddress, "to make room for", entryToWrite);
      displacedEntry = this.getEntryAtAddress(currentAddress);
      console.log("displacedEntry", displacedEntry);
      console.log("Write", entryToWrite, "at", currentAddress);
      this.writeEntryAtAddress(entryToWrite, currentAddress);
      if (
        displacedEntry[0] === 0 &&
        displacedEntry[1] === 0 &&
        displacedEntry[2] === 0 &&
        displacedEntry[3] === 0
      ) {
        console.log("Successfull store after", iterationCounter);
        return;
      }
      entryToWrite = displacedEntry;

      // todo: displacedEntry[0:5]
      currentAddress = this._hashKey(this.seed2, entryToWrite, 1);
      console.log("Try to evict at", currentAddress, "to make room for", entryToWrite);
      displacedEntry = this.getEntryAtAddress(currentAddress);
      console.log("displacedEntry", displacedEntry);
      console.log("Write", entryToWrite, "at", currentAddress);
      this.writeEntryAtAddress(entryToWrite, currentAddress);

      if (
        displacedEntry[0] === 0 &&
        displacedEntry[1] === 0 &&
        displacedEntry[2] === 0 &&
        displacedEntry[3] === 0
      ) {
        console.log("Successfull store after", iterationCounter);
        return;
      }

      entryToWrite = displacedEntry;
      currentAddress = this._hashKey(this.seed1, entryToWrite, 0);
    }

    throw new Error("couldnt add key. tried", iterationCounter);
  }

  getValue(key: Vector4): number {
    const hashedAddress1 = this._hashKey(this.seed1, key, 0);
    const hashedAddress2 = this._hashKey(this.seed2, key, 1);

    return this.getValueForAddresses(key, hashedAddress1, hashedAddress2);
  }

  // hasEntry(key: Vector4, value: number, hashedAddress1: number, hashedAddress2: number): boolean {
  //   return this.isEntry(key, value, hashedAddress1) || this.isEntry(key, value, hashedAddress2);
  // }

  getEntryAtAddress(hashedAddress: number): Vector4 {
    const offset = hashedAddress * entriesPerKey;
    return [
      this.table[offset + 0],
      this.table[offset + 1],
      this.table[offset + 2],
      this.table[offset + 3],
      this.table[offset + 4],
    ];
  }

  getValueForAddresses(key: Vector4, hashedAddress1: number, hashedAddress2: number) {
    const value1 = this.getValueAtAddress(key, hashedAddress1);
    if (value1 !== -1) {
      return value1;
    }
    const value2 = this.getValueAtAddress(key, hashedAddress2);
    if (value2 !== -1) {
      return value2;
    }

    return -1;
  }

  isAddressValidForKey(key: Vector4, hashedAddress): boolean {
    const offset = hashedAddress * entriesPerKey;
    return (
      (this.table[offset] === 0 &&
        this.table[offset + 1] === 0 &&
        this.table[offset + 2] === 0 &&
        this.table[offset + 3] === 0) ||
      (this.table[offset] === key[0] &&
        this.table[offset + 1] === key[1] &&
        this.table[offset + 2] === key[2] &&
        this.table[offset + 3] === key[3])
    );
  }

  doesAddressContainKey(key: Vector4, hashedAddress): boolean {
    const offset = hashedAddress * entriesPerKey;
    return (
      this.table[offset] === key[0] &&
      this.table[offset + 1] === key[1] &&
      this.table[offset + 2] === key[2] &&
      this.table[offset + 3] === key[3]
    );
  }

  getValueAtAddress(key: Vector4, hashedAddress): number {
    const offset = hashedAddress * entriesPerKey;
    if (this.doesAddressContainKey(key, hashedAddress)) {
      return this.table[offset + 4];
    } else {
      return -1;
    }
  }

  writeEntryAtAddress(keyValue: Vector5, hashedAddress): boolean {
    const offset = hashedAddress * entriesPerKey;
    // eslint-disable-next-line prefer-destructuring
    this.table[offset] = keyValue[0];
    // eslint-disable-next-line prefer-destructuring
    this.table[offset + 1] = keyValue[1];
    // eslint-disable-next-line prefer-destructuring
    this.table[offset + 2] = keyValue[2];
    // eslint-disable-next-line prefer-destructuring
    this.table[offset + 3] = keyValue[3];
    // eslint-disable-next-line prefer-destructuring
    this.table[offset + 4] = keyValue[4];
  }

  // MurmurHash excluding the final mixing steps.
  _hashCombine(state: number, value: number) {
    const k1 = 0xcc9e2d51;
    const k2 = 0x1b873593;

    // eslint-disable-next-line no-param-reassign
    value >>>= 0;
    // eslint-disable-next-line no-param-reassign
    state >>>= 0;

    // eslint-disable-next-line no-param-reassign
    value = Math.imul(value, k1) >>> 0;
    // eslint-disable-next-line no-param-reassign
    value = ((value << 15) | (value >>> 17)) >>> 0;
    // eslint-disable-next-line no-param-reassign
    value = Math.imul(value, k2) >>> 0;
    // eslint-disable-next-line no-param-reassign
    state = (state ^ value) >>> 0;
    // eslint-disable-next-line no-param-reassign
    state = ((state << 13) | (state >>> 19)) >>> 0;
    // eslint-disable-next-line no-param-reassign
    state = (state * 5 + 0xe6546b64) >>> 0;
    return state % this.capacity;
  }

  _hashKey(seed: number, address: Vector4, tableIndex: number): number {
    // todo: unroll this for better performance ?
    let state = this._hashCombine(seed, address[0]);
    state = this._hashCombine(state, address[1]);
    state = this._hashCombine(state, address[2]);
    state = this._hashCombine(state, address[3]);

    return state + tableIndex * this.capacity;
  }
}

window.CuckooTable = CuckooTable;

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

      const isBaseBucket = bucketZoomStep === currentZoomStep;
      const isFirstFallback = bucketZoomStep - 1 === currentZoomStep;
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
      } else if (isFirstFallback) {
        if (address !== -1) {
          const baseBucketAddresses = this._getBaseBucketAddresses(bucket, 1);
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
      } else {
        // Don't handle buckets with zoomStepDiff > 1, because filling the corresponding
        // positions in the lookup buffer would take 8**zoomStepDiff iterations PER bucket.
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

  _getBaseBucketAddresses(bucket: DataBucket, zoomStepDifference: number): Array<Vector4> {
    const resolutions = getResolutions(Store.getState().dataset);
    return getBaseBucketsForFallbackBucket(bucket.zoomedAddress, zoomStepDifference, resolutions);
  }
}
