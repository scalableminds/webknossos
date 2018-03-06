// @flow
import { DataBucket, BUCKET_SIZE_P } from "oxalis/model/binary/bucket";
import type { Vector3, Vector4 } from "oxalis/constants";
import constants from "oxalis/constants";
import _ from "lodash";
import * as THREE from "three";
import UpdatableTexture from "libs/UpdatableTexture";
import window from "libs/window";
import { createUpdatableTexture } from "oxalis/geometries/materials/abstract_plane_material_factory";
import SceneController from "oxalis/controller/scene_controller";
import type { Bucket } from "oxalis/model/binary/bucket";

const bucketWidth = 32;
const bucketSize = Math.pow(bucketWidth, 3);
const bytesPerLookUpEntry = 1; // just the index ?
const lookUpBufferWidth = 64; // has to be next power of two from Math.ceil(Math.sqrt(lookUpBufferSize));

export function zoomedAddressToPosition([x, y, z, zoomStep]: Vector4): Vector3 {
  return [
    x << (BUCKET_SIZE_P + zoomStep),
    y << (BUCKET_SIZE_P + zoomStep),
    z << (BUCKET_SIZE_P + zoomStep),
  ];
}

const grayBuffer = new Uint8Array(bucketSize);
grayBuffer.fill(100);
const bucketHeightInTexture = 4;

export default class TextureBucketManager {
  dataTexture: UpdatableTexture;
  lookUpBuffer: Float32Array;
  lookUpTexture: THREE.DataTexture;
  storedBucketToIndexMap: Map<DataBucket, number>;
  committedBucketSet: Set<DataBucket>;
  freeIndexSet: Set<number>;
  isRefreshBufferOutOfDate: boolean;

  bucketPerDim: number;
  bufferCapacity: number;
  currentAnchorPoint: ?Vector4;
  writerQueue: Array<{ bucket: DataBucket, index: number }>;

  constructor(bucketPerDim: number, layer) {
    this.layer = layer;
    // each plane gets bucketPerDim**2 buckets
    this.bufferCapacity = 3 * Math.pow(bucketPerDim, 2);
    // the look up buffer is bucketPerDim**3 so that arbitrary look ups can be made
    const lookUpBufferSize = Math.pow(lookUpBufferWidth, 2); // Math.pow(bucketPerDim, 3) * bytesPerLookUpEntry;

    this.lookUpBuffer = new Float32Array(lookUpBufferSize);

    this.storedBucketToIndexMap = new Map();
    this.freeIndexSet = new Set(_.range(this.bufferCapacity));
    this.committedBucketSet = new Set();

    this.bucketPerDim = bucketPerDim;
    this.currentAnchorPoint = null;

    this.isRefreshBufferOutOfDate = false;
    this.keepRefreshBufferUpToDate();

    this.writerQueue = [];
    this.processWriterQueue();
  }

  keepRefreshBufferUpToDate() {
    if (this.isRefreshBufferOutOfDate) {
      this._refreshLookUpBuffer();
    }
    window.requestAnimationFrame(() => {
      this.keepRefreshBufferUpToDate();
    });
  }

  processWriterQueue() {
    let processedItems = 0;
    // uniqBy removes multiple write-buckets-requests for the same index.
    // It preserves the first occurence of each duplicate, which is why
    // this queue has to be filled from the front (via unshift) und read from the
    // back (via pop). This ensures that the newest bucket is written.
    this.writerQueue = _.uniqBy(this.writerQueue, el => el._index);
    const maxBucketCommitsPerFrame = 30;

    while (processedItems++ < maxBucketCommitsPerFrame && this.writerQueue.length > 0) {
      const { bucket, _index } = this.writerQueue.pop();
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
    }

    window.requestAnimationFrame(() => {
      this.processWriterQueue();
    });
  }

  setupDataTextures(bytes: number, binaryCategory: string): void {
    // const bytes = this.targetBitDepth >> 3;
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

  _requestWriteBucketToBuffer(bucket: Bucket, index: number): void {
    this.freeIndexSet.delete(index);

    const requestWriteBucketImpl = _index => {
      if (!bucket.hasData()) {
        return;
      }
      this.writerQueue.unshift({ bucket, _index });
    };
    requestWriteBucketImpl(index);

    this.storedBucketToIndexMap.set(bucket, index);
    const updateBucketData = () => {
      // Check that the bucket is still in the data texture.
      // Also the index could have changed, so retrieve the index again.
      const bucketIndex = this.storedBucketToIndexMap.get(bucket);
      if (bucketIndex != null) {
        requestWriteBucketImpl(bucketIndex);
      } else {
        bucket.off("bucketLabeled", debouncedUpdateBucketData);
      }
    };

    // todo: not necessary anymore since committing the buckets is always
    // batched and debounced via requestAnimationFrame
    const debouncedUpdateBucketData = _.debounce(updateBucketData, 16);

    if (!bucket.hasData()) {
      bucket.on("bucketLoaded", updateBucketData);
    }
    bucket.on("bucketLabeled", debouncedUpdateBucketData);
  }

  storeBuckets(buckets: Array<DataBucket>, anchorPoint: Vector3): void {
    this.currentAnchorPoint = anchorPoint;
    // Find out which buckets are not needed anymore
    const freeBucketSet = new Set(this.storedBucketToIndexMap.keys());
    for (const bucket of buckets) {
      freeBucketSet.delete(bucket);
    }

    // Remove unused buckets
    const freeBuckets = Array.from(freeBucketSet.values());
    for (const freeBucket of freeBuckets) {
      const unusedIndex = this.storedBucketToIndexMap.get(freeBucket);
      this.storedBucketToIndexMap.delete(freeBucket);
      this.committedBucketSet.delete(freeBucket);
      this.freeIndexSet.add(unusedIndex);
    }

    const freeIndexArray = Array.from(this.freeIndexSet);
    while (buckets.length > 0) {
      const nextBucket = buckets.shift();
      freeBucketSet.delete(nextBucket);
      if (!this.storedBucketToIndexMap.has(nextBucket)) {
        if (freeIndexArray.length === 0) {
          throw new Error("A new bucket should be stored but there is no space for it?");
        }
        const freeBucketIdx = freeIndexArray.shift();
        this._requestWriteBucketToBuffer(nextBucket, freeBucketIdx);
      }
    }

    // Completely re-write the lookup buffer. This could be smarter, but it's
    // probably not worth it.
    this._refreshLookUpBuffer();
  }

  _refreshLookUpBuffer() {
    const anchorPoint = this.currentAnchorPoint;
    this.lookUpBuffer.fill(-1);

    for (const [bucket, address] of this.storedBucketToIndexMap) {
      if (this.committedBucketSet.has(bucket)) {
        const lookUpIdx = this._getBucketIndex(bucket, anchorPoint);
        this.lookUpBuffer[bytesPerLookUpEntry * lookUpIdx] = address;
      }
    }

    this.lookUpTexture.update(this.lookUpBuffer, 0, 0, lookUpBufferWidth, lookUpBufferWidth);
    this.isRefreshBufferOutOfDate = false;
    window.needsRerender = true;
  }

  _getBucketIndex(bucket: DataBucket, anchorPoint: Vector3): number {
    const bucketPosition = bucket.zoomedAddress.slice(0, 3);
    const offsetFromAnchor = [
      bucketPosition[0] - anchorPoint[0],
      bucketPosition[1] - anchorPoint[1],
      bucketPosition[2] - anchorPoint[2],
    ];
    let [x, y, z] = offsetFromAnchor;

    const idx = Math.pow(this.bucketPerDim, 2) * z + this.bucketPerDim * y + x;
    return idx;
  }
}
