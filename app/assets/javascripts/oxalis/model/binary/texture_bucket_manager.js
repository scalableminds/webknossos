// @flow
import { DataBucket } from "oxalis/model/binary/bucket";
import type { Vector4 } from "oxalis/constants";
import constants from "oxalis/constants";
import _ from "lodash";
import * as THREE from "three";
import UpdatableTexture from "libs/UpdatableTexture";
import window from "libs/window";
import { createUpdatableTexture } from "oxalis/geometries/materials/abstract_plane_material_factory";
import SceneController from "oxalis/controller/scene_controller";

const bytesPerLookUpEntry = 1; // just the index ?
const lookUpBufferWidth = 64; // has to be next power of two from Math.ceil(Math.sqrt(lookUpBufferSize));

const bucketHeightInTexture = 4;

// A TextureBucketManager instance is responsible for making buckets of
// avaible to the GPU.
// setActiveBuckets can be called with an array of buckets, which will be
// written into the dataTexture and lookUpTexture of this class instance.
// Buckets which are already in this texture won't be written again.
// Buckets which are not needed anymore will be replaced by other buckets.

// A bucket is considered "active" if it is supposed to be in the data texture.
// A bucket is considered "committed" if it is indeed in the data texture.
// Active buckets will be pushed into a writerQueue which is processed by
// writing buckets to the data texture (i.e., "committing the buckets").

export default class TextureBucketManager {
  dataTexture: UpdatableTexture;
  lookUpBuffer: Float32Array;
  lookUpTexture: THREE.DataTexture;
  // Holds the index for each active bucket, to which it should (or already
  // has been was) written in the data texture.
  activeBucketToIndexMap: Map<DataBucket, number> = new Map();
  // Maintains the set of committed buckets
  committedBucketSet: Set<DataBucket> = new Set();
  // Maintains a set of free indices within the data texture.
  freeIndexSet: Set<number>;
  isRefreshBufferOutOfDate: boolean = false;
  lastZoomedAnchorPoint: Vector4;

  bucketPerDim: number;
  bufferCapacity: number;
  currentAnchorPoint: Vector4 = [0, 0, 0, 0];
  writerQueue: Array<{ bucket: DataBucket, _index: number }> = [];

  constructor(bucketPerDim: number) {
    // each plane gets bucketPerDim**2 buckets
    this.bufferCapacity = 3 * Math.pow(bucketPerDim, 2);
    // the look up buffer is bucketPerDim**3 so that arbitrary look ups can be made
    const lookUpBufferSize = Math.pow(lookUpBufferWidth, 2); // Math.pow(bucketPerDim, 3) * bytesPerLookUpEntry;
    this.bucketPerDim = bucketPerDim;

    this.lookUpBuffer = new Float32Array(lookUpBufferSize);
    this.freeIndexSet = new Set(_.range(this.bufferCapacity));

    this.keepLookUpBufferUpToDate();
    this.processWriterQueue();
  }

  clear() {
    this.setActiveBuckets([], [0, 0, 0, 0]);
  }

  // Takes an array of buckets (relative to an anchorPoint) and ensures that these
  // are written to the dataTexture. The lookUpTexture will be updated to reflect the
  // new buckets.
  setActiveBuckets(buckets: Array<DataBucket>, anchorPoint: Vector4): void {
    this.currentAnchorPoint = anchorPoint;
    // Find out which buckets are not needed anymore
    const freeBucketSet = new Set(this.activeBucketToIndexMap.keys());
    for (const bucket of buckets) {
      freeBucketSet.delete(bucket);
    }

    // Remove unused buckets
    const freeBuckets = Array.from(freeBucketSet.values());
    for (const freeBucket of freeBuckets) {
      const unusedIndex = this.activeBucketToIndexMap.get(freeBucket);
      this.activeBucketToIndexMap.delete(freeBucket);
      this.committedBucketSet.delete(freeBucket);
      // Flow thinks that unusedIndex may be undefined.
      // However, the freeBuckets can only contain buckets which
      // are held by activeBucketToIndexMap since we use the map
      // for initialization. For performance reason, we don't satisfy
      // flow with an undefined check.
      // $FlowFixMe
      this.freeIndexSet.add(unusedIndex);
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
    let processedItems = 0;
    // uniqBy removes multiple write-buckets-requests for the same index.
    // It preserves the first occurence of each duplicate, which is why
    // this queue has to be filled from the front (via unshift) und read from the
    // back (via pop). This ensures that the newest bucket "wins" if they are
    // multiple buckets for the same index.
    this.writerQueue = _.uniqBy(this.writerQueue, el => el._index);
    const maxBucketCommitsPerFrame = 30;

    while (processedItems < maxBucketCommitsPerFrame && this.writerQueue.length > 0) {
      const { bucket, _index } = this.writerQueue.pop();
      if (!this.activeBucketToIndexMap.has(bucket)) {
        // This bucket is not needed anymore
        continue;
      }
      this.dataTexture.update(
        bucket.getData(),
        0,
        bucketHeightInTexture * _index,
        constants.DATA_TEXTURE_WIDTH,
        bucketHeightInTexture,
      );
      this.committedBucketSet.add(bucket);
      window.needsRerender = true;
      this.isRefreshBufferOutOfDate = true;
      processedItems++;
    }

    if (processedItems > 0) {
      // console.log(`committed ${processedItems} buckets to texture`);
    }

    window.requestAnimationFrame(() => {
      this.processWriterQueue();
    });
  }

  setupDataTextures(bytes: number, binaryCategory: string): void {
    const tWidth = constants.DATA_TEXTURE_WIDTH;

    const dataTexture = createUpdatableTexture(
      tWidth,
      bytes,
      THREE.UnsignedByteType,
      SceneController.renderer,
    );

    dataTexture.binaryCategory = binaryCategory;

    const lookUpTexture = createUpdatableTexture(
      lookUpBufferWidth,
      1,
      THREE.FloatType,
      SceneController.renderer,
    );

    this.dataTexture = dataTexture;
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
    debouncedUpdateBucketData = _.debounce(updateBucketData, 16);

    if (!bucket.hasData()) {
      bucket.on("bucketLoaded", updateBucketData);
    }
    bucket.on("bucketLabeled", debouncedUpdateBucketData);
  }

  _refreshLookUpBuffer() {
    // Completely re-write the lookup buffer. This could be smarter, but it's
    // probably not worth it.
    const anchorPoint = this.currentAnchorPoint;
    this.lookUpBuffer.fill(-1);

    for (const bucket of this.committedBucketSet) {
      const address = this.activeBucketToIndexMap.get(bucket);
      const lookUpIdx = this._getBucketIndex(bucket, anchorPoint);
      // Since activeBucketToIndexMap is a super set of committedBucketSet,
      // address is always defined ($FlowFixMe).
      this.lookUpBuffer[bytesPerLookUpEntry * lookUpIdx] = address;
    }

    this.lookUpTexture.update(this.lookUpBuffer, 0, 0, lookUpBufferWidth, lookUpBufferWidth);
    this.isRefreshBufferOutOfDate = false;
    window.needsRerender = true;
  }

  _getBucketIndex(bucket: DataBucket, anchorPoint: Vector4): number {
    const bucketPosition = bucket.zoomedAddress.slice(0, 3);
    const offsetFromAnchor = [
      bucketPosition[0] - anchorPoint[0],
      bucketPosition[1] - anchorPoint[1],
      bucketPosition[2] - anchorPoint[2],
    ];
    const [x, y, z] = offsetFromAnchor;

    const idx = Math.pow(this.bucketPerDim, 2) * z + this.bucketPerDim * y + x;
    return idx;
  }
}
