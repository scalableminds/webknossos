// @flow
import { DataBucket, BUCKET_SIZE_P } from "oxalis/model/binary/bucket";
import type { Vector3, Vector4 } from "oxalis/constants";
import constants from "oxalis/constants";
import _ from "lodash";
import * as THREE from "three";
import UpdatableTexture from "libs/UpdatableTexture";

const bucketWidth = 32;
const bucketSize = Math.pow(bucketWidth, 3);
const bytesPerLookUpEntry = 1; // just the index ?

export function zoomedAddressToPosition([x, y, z, zoomStep]: Vector4): Vector3 {
  return [
    x << (BUCKET_SIZE_P + zoomStep),
    y << (BUCKET_SIZE_P + zoomStep),
    z << (BUCKET_SIZE_P + zoomStep),
  ];
}

const grayBuffer = new Uint8Array(bucketSize);
grayBuffer.fill(100);

export default class TextureBucketManager {
  dataBuffer: Uint8Array;
  dataTexture: UpdatableTexture;
  lookUpBuffer: Float32Array;
  lookUpTexture: THREE.DataTexture;
  storedBucketToIndexMap: Map<DataBucket, number>;
  freeIndexSet: Set<number>;

  bucketPerDim: number;
  bufferCapacity: number;

  constructor(bucketPerDim: number) {
    // each plane gets bucketPerDim**2 buckets
    this.bufferCapacity = 3 * Math.pow(bucketPerDim, 2);
    const dataBufferSize = this.bufferCapacity * bucketSize;
    // the look up buffer is bucketPerDim**3 so that arbitrary look ups can be made
    const lookUpBufferSize = Math.pow(64, 2); // Math.pow(bucketPerDim, 3) * bytesPerLookUpEntry;
    // const lookUpBufferWidth = Math.ceil(Math.sqrt(lookUpBufferSize)); // Textures have to be quadratical

    this.dataBuffer = new Uint8Array(8192 ** 2); // dataBufferSize
    window.dataBuffers = (window.dataBuffers || []).concat(this.dataBuffer);
    this.lookUpBuffer = new Float32Array(lookUpBufferSize);

    this.storedBucketToIndexMap = new Map();
    this.freeIndexSet = new Set(_.range(this.bufferCapacity));

    this.bucketPerDim = bucketPerDim;
  }

  setupDataTextures(dataTexture: UpdatableTexture, lookUpTexture: THREE.DataTexture): void {
    this.dataTexture = dataTexture;
    this.lookUpTexture = lookUpTexture;
  }

  getLookUpBuffer() {
    return this.lookUpBuffer;
  }

  // getDataBuffer() {
  //   return this.dataBuffer;
  // }

  _writeBucketToBuffer(bucket: Bucket, index: number): void {
    this.freeIndexSet.delete(index);

    const bucketHeightInTexture = 4;
    this.dataTexture.update(
      bucket.hasData() ? bucket.getData() : grayBuffer,
      0,
      bucketHeightInTexture * index,
      constants.DATA_TEXTURE_WIDTH,
      bucketHeightInTexture,
    );

    this.storedBucketToIndexMap.set(bucket, index);
    if (!bucket.hasData()) {
      bucket.once("bucketLoaded", () => {
        // Check that the bucket is still in the data texture.
        // Also the index could have changed, so retrieve the index again.
        const bucketIndex = this.storedBucketToIndexMap.get(bucket);
        if (bucketIndex != null) {
          this._writeBucketToBuffer(bucket, bucketIndex);
        }
      });
    }
  }

  storeBuckets(buckets: Array<DataBucket>, anchorPoint: Vector3): number {
    // Mantain a dirty set so that we know which buckets, we can replace
    const dirtySet = new Set(this.storedBucketToIndexMap.keys());

    const freeIndexArray = Array.from(this.freeIndexSet);
    let updatedBuckets = 0;
    while (buckets.length > 0 && freeIndexArray.length > 0) {
      const nextBucket = buckets.shift();
      dirtySet.delete(nextBucket);
      if (!this.storedBucketToIndexMap.has(nextBucket)) {
        const freeBucketIdx = freeIndexArray.shift();
        this._writeBucketToBuffer(nextBucket, freeBucketIdx);
        updatedBuckets++;
      }
    }

    // console.time("write new buckets");
    const freeBuckets = Array.from(dirtySet.values());

    // Remove unused buckets
    for (const freeBucket of freeBuckets) {
      const unusedIndex = this.storedBucketToIndexMap.get(freeBucket);
      this.storedBucketToIndexMap.delete(freeBucket);
      this.freeIndexSet.add(unusedIndex);
    }
    // console.timeEnd("write new buckets");

    // Completely re-write the lookup buffer. This could be smarter, but it's probably not worth it.
    // console.time("rewrite-looup-buffer");
    // this.dataTexture.image.data = this.dataBuffer;
    // this.dataTexture.needsUpdate = true;
    this._refreshLookUpBuffer(anchorPoint);
    // console.timeEnd("rewrite-looup-buffer");
    return updatedBuckets;
  }

  _refreshLookUpBuffer(anchorPoint: Vector3) {
    this.lookUpBuffer.fill(-1);

    for (const [bucket, address] of this.storedBucketToIndexMap) {
      const lookUpIdx = this._getBucketIndex(bucket, anchorPoint);
      this.lookUpBuffer[bytesPerLookUpEntry * lookUpIdx] = address;
    }
    // this.lookUpTexture.image.data = this.lookUpBuffer;
    // this.lookUpTexture.needsUpdate = true;
    this.lookUpTexture.update(this.lookUpBuffer, 0, 0, 64, 64);
    console.log("updating lookup buffer");
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
