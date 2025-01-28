import app from "app";
import type UpdatableTexture from "libs/UpdatableTexture";
import type { CuckooTableVec5 } from "libs/cuckoo/cuckoo_table_vec5";
import { waitForCondition } from "libs/utils";
import window from "libs/window";
import _ from "lodash";
import { WkDevFlags } from "oxalis/api/wk_dev";
import constants, { type TypedArray } from "oxalis/constants";
import { getRenderer } from "oxalis/controller/renderer";
import { createUpdatableTexture } from "oxalis/geometries/materials/plane_material_factory_helpers";
import type { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import {
  getBucketCapacity,
  getChannelCount,
  getDtypeConfigForElementClass,
  getPackingDegree,
} from "oxalis/model/bucket_data_handling/data_rendering_logic";
import type * as THREE from "three";
import type { ElementClass } from "types/api_flow_types";

// A TextureBucketManager instance is responsible for making buckets available
// to the GPU.
// setActiveBuckets can be called with an array of buckets, which will be
// written into the dataTexture and lookUpTexture of this class instance
// (note that the lookUpTexture is shared across all layers).
// Buckets which are already in this texture won't be written again.
// Buckets which are not needed anymore will be replaced by other buckets.
// A bucket is considered "active" if it is supposed to be in the data texture.
// A bucket is considered "committed" if it is indeed in the data texture.
// Active buckets will be pushed into a writerQueue which is processed by
// writing buckets to the data texture (i.e., "committing the buckets").
//
// Within the lookUpTexture, we store one unsigned integer i per bucket.
// If i == 2**21 - 1, the bucket is not yet committed.
// Otherwise, i denotes the index in the data texture where the bucket is stored.

// See the explanations in the module that defines CuckooTableVec5 to read about
// the theoretical limitations of the look up approach.

const NOT_YET_COMMITTED_VALUE = 2 ** 21 - 1;

function getSomeValue<T>(set: Set<T>): T {
  const { value } = set.values().next();

  if (value == null) {
    throw new Error("Cannot get value of set because it's empty.");
  }

  return value;
}

const tmpPaddingBuffer = new Uint8Array(4 * constants.BUCKET_SIZE);
// todop: adapt when adding new dtypes
function maybePadRgbData(src: TypedArray, elementClass: ElementClass) {
  if (elementClass !== "uint24") {
    return src;
  }

  // Copy the RGB data to an RGBA buffer, since ThreeJS does not support RGB textures
  // since r137.
  let idx = 0;
  let srcIdx = 0;
  while (srcIdx < 3 * constants.BUCKET_SIZE) {
    // @ts-ignore BigInt is not a problem as this code here only handles uint24 data
    tmpPaddingBuffer[idx++] = src[srcIdx++];
    // @ts-ignore BigInt is not a problem as this code here only handles uint24 data
    tmpPaddingBuffer[idx++] = src[srcIdx++];
    // @ts-ignore BigInt is not a problem as this code here only handles uint24 data
    tmpPaddingBuffer[idx++] = src[srcIdx++];
    tmpPaddingBuffer[idx++] = 255;
  }

  return tmpPaddingBuffer;
}

export default class TextureBucketManager {
  dataTextures: Array<UpdatableTexture>;
  layerIndex: number = -1;
  lookUpCuckooTable!: CuckooTableVec5;
  // Holds the index for each active bucket, to which it should (or already
  // has been was) written in the data texture.
  activeBucketToIndexMap: Map<DataBucket, number> = new Map();
  // Maintains the set of committed buckets
  committedBucketSet: WeakSet<DataBucket> = new WeakSet();
  // Maintains a set of free indices within the data texture.
  freeIndexSet: Set<number>;
  isRefreshBufferOutOfDate: boolean = false;
  writerQueue: Array<{
    bucket: DataBucket;
    _index: number;
  }> = [];

  textureWidth: number;
  dataTextureCount: number;
  maximumCapacity: number;
  packingDegree: number;
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
    this.textureWidth = textureWidth;
    this.dataTextureCount = dataTextureCount;
    this.freeIndexSet = new Set(_.range(this.maximumCapacity));
    this.dataTextures = [];
  }

  async startRAFLoop() {
    await waitForCondition(
      () =>
        this.lookUpCuckooTable?._texture.isInitialized() && this.dataTextures[0].isInitialized(),
    );
    this.processWriterQueue();
  }

  clear() {
    this.setActiveBuckets([]);
  }

  freeBucket(bucket: DataBucket): void {
    const unusedIndex = this.activeBucketToIndexMap.get(bucket);

    if (unusedIndex == null) {
      return;
    }

    if (WkDevFlags.bucketDebugging.visualizeBucketsOnGPU) {
      bucket.unvisualize();
    }

    this.activeBucketToIndexMap.delete(bucket);
    this.committedBucketSet.delete(bucket);
    this.freeIndexSet.add(unusedIndex);
    this.lookUpCuckooTable.unset([
      bucket.zoomedAddress[0],
      bucket.zoomedAddress[1],
      bucket.zoomedAddress[2],
      bucket.zoomedAddress[3],
      this.layerIndex,
    ]);

    // If a bucket is evicted from the GPU, it should not be rendered, anymore.
    // This is especially important when new buckets take a while to load. In that
    // time window, old data should not be rendered.
    app.vent.emit("rerender");
  }

  // Takes an array of buckets and ensures that these
  // are written to the dataTexture. The lookUpTexture will be updated to reflect the
  // new buckets.
  setActiveBuckets(buckets: Array<DataBucket>): void {
    // Find out which buckets are not needed anymore
    const freeBucketSet = new Set(this.activeBucketToIndexMap.keys());

    for (const bucket of buckets) {
      freeBucketSet.delete(bucket);
    }

    // Remove unused buckets
    for (const freeBucket of freeBucketSet.values()) {
      this.freeBucket(freeBucket);
    }

    for (const nextBucket of buckets) {
      if (!this.activeBucketToIndexMap.has(nextBucket)) {
        if (this.freeIndexSet.size === 0) {
          throw new Error("A new bucket should be stored but there is no space for it?");
        }

        const freeBucketIdx = getSomeValue(this.freeIndexSet);
        this.reserveIndexForBucket(nextBucket, freeBucketIdx);
      }
    }
  }

  getPackedBucketSize() {
    return constants.BUCKET_SIZE / this.packingDegree;
  }

  // Commit "active" buckets by writing these to the dataTexture.
  processWriterQueue() {
    // uniqBy removes multiple write-buckets-requests for the same index.
    // It preserves the first occurrence of each duplicate, which is why
    // this queue has to be filled from the front (via unshift) und read from the
    // back (via pop). This ensures that the newest bucket "wins" if there are
    // multiple buckets for the same index.
    this.writerQueue = _.uniqBy(this.writerQueue, (el) => el._index);
    const maxTimePerFrame = 16;
    const startingTime = performance.now();
    const packedBucketSize = this.getPackedBucketSize();
    const bucketHeightInTexture = packedBucketSize / this.textureWidth;
    const bucketsPerTexture = (this.textureWidth * this.textureWidth) / packedBucketSize;

    while (this.writerQueue.length > 0 && performance.now() - startingTime < maxTimePerFrame) {
      // @ts-expect-error pop cannot return null due to the while condition
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

      if (WkDevFlags.bucketDebugging.visualizeBucketsOnGPU) {
        bucket.visualize();
      }

      const dataTextureIndex = Math.floor(_index / bucketsPerTexture);
      const indexInDataTexture = _index % bucketsPerTexture;
      const data = bucket.getData();
      const { TypedArrayClass } = getDtypeConfigForElementClass(this.elementClass);

      const rawSrc = new TypedArrayClass(
        data.buffer,
        data.byteOffset,
        data.byteLength / TypedArrayClass.BYTES_PER_ELEMENT,
      );

      const src = maybePadRgbData(rawSrc, this.elementClass);

      this.dataTextures[dataTextureIndex].update(
        src,
        0,
        bucketHeightInTexture * indexInDataTexture,
        this.textureWidth,
        bucketHeightInTexture,
      );
      this.committedBucketSet.add(bucket);

      this.lookUpCuckooTable.set(
        [
          bucket.zoomedAddress[0],
          bucket.zoomedAddress[1],
          bucket.zoomedAddress[2],
          bucket.zoomedAddress[3],
          this.layerIndex,
        ],
        _index,
      );

      // bucket.setVisualizationColor("#00ff00");
      // bucket.visualize();
      app.vent.emit("rerender");
    }

    window.requestAnimationFrame(() => {
      this.processWriterQueue();
    });
  }

  getTextures(): Array<THREE.DataTexture | UpdatableTexture> {
    return [this.lookUpCuckooTable._texture].concat(this.dataTextures);
  }

  setupDataTextures(bytes: number, lookUpCuckooTable: CuckooTableVec5, layerIndex: number): void {
    for (let i = 0; i < this.dataTextureCount; i++) {
      const channelCount = getChannelCount(bytes, this.packingDegree, this.elementClass);

      const { textureType, pixelFormat, internalFormat } = getDtypeConfigForElementClass(
        this.elementClass,
      );

      const dataTexture = createUpdatableTexture(
        this.textureWidth,
        this.textureWidth,
        channelCount,
        textureType,
        getRenderer(),
        pixelFormat,
        internalFormat,
      );

      this.dataTextures.push(dataTexture);
    }

    this.lookUpCuckooTable = lookUpCuckooTable;
    this.layerIndex = layerIndex;
    this.startRAFLoop();
  }

  // Assign an index to an active bucket and enqueue the bucket-index-tuple
  // to the writerQueue. Also, make sure that the bucket data is updated if
  // it changes.
  reserveIndexForBucket(bucket: DataBucket, index: number): void {
    this.freeIndexSet.delete(index);
    this.activeBucketToIndexMap.set(bucket, index);

    this.lookUpCuckooTable.set(
      [
        bucket.zoomedAddress[0],
        bucket.zoomedAddress[1],
        bucket.zoomedAddress[2],
        bucket.zoomedAddress[3],
        this.layerIndex,
      ],
      NOT_YET_COMMITTED_VALUE,
    );

    const enqueueBucket = (_index: number) => {
      if (!bucket.hasData()) {
        return;
      }

      this.writerQueue.unshift({
        bucket,
        _index,
      });
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
}
