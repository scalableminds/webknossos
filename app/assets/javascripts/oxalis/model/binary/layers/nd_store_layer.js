/**
 * nd_store_layer.js
 * @flow
 */

import _ from "lodash";
import { BUCKET_SIZE_P } from "oxalis/model/binary/bucket";
import Layer from "oxalis/model/binary/layers/layer";
import type { LayerInfoType, DataStoreInfoType } from "oxalis/model/binary/layers/layer";
import type { BucketInfo } from "oxalis/model/binary/layers/bucket_builder";
import Request from "libs/request";
import ErrorHandling from "libs/error_handling";
import type { Vector3, Vector4, Vector6 } from "oxalis/constants";


class NdStoreLayer extends Layer {

  constructor(layerInfo: LayerInfoType, dataStoreInfo: DataStoreInfoType) {
    super(layerInfo, dataStoreInfo);

    if (this.dataStoreInfo.typ !== "ndstore") {
      throw new Error("NDstoreLayer should only be instantiated with ndstore");
    }
  }

  // eslint-disable-next-line no-unused-vars
  sendToStoreImpl(batch: Array<BucketInfo>, getBucketData: (Vector4) => Uint8Array, token: string): Promise<*> {
    throw new Error("NDstore does not currently support sendToStore");
  }


  requestDataToken(): Promise<string> {
    // ndstore uses its own token that is fixed
    return Promise.resolve(this.dataStoreInfo.accessToken);
  }


  async requestFromStoreImpl(batch: Array<BucketInfo>, token: string): Promise<Uint8Array> {
    ErrorHandling.assert(batch.length === 1, "Batch length should be 1 for NDstore Layers");

    const [bucket] = batch;
    const bucketSize = bucket.cubeSize;

    // ndstore cannot deliver data for coordinates that are out of bounds
    const bounds = this.clampBucketToMaxCoordinates(bucket);
    const url = `${this.dataStoreInfo.url}/ca/${token}/raw/raw/${bucket.zoomStep}/
      ${bounds[0]},${bounds[3]}/
      ${bounds[1]},${bounds[4]}/
      ${bounds[2]},${bounds[5]}/`;

    // if at least one dimension is completely out of bounds, return an empty array
    if (bounds[0] >= bounds[3] || bounds[1] >= bounds[4] || bounds[2] >= bounds[5]) {
      return Promise.resolve(new Uint8Array(bucketSize * bucketSize * bucketSize));
    }

    const responseBuffer = await Request.receiveArraybuffer(url);
    // the untyped array cannot be accessed by index, use a dataView for that
    const dataView = new DataView(responseBuffer);

    // create a typed uint8 array that is initialized with zeros
    const buffer = new Uint8Array(bucketSize * bucketSize * bucketSize);
    const bucketBounds = this.getMaxCoordinatesAsBucket(bounds, bucket);

    // copy the ndstore response into the new array, respecting the bounds of the dataset
    let index = 0;
    for (let z = bucketBounds[2]; z < bucketBounds[5]; z++) {
      for (let y = bucketBounds[1]; y < bucketBounds[4]; y++) {
        for (let x = bucketBounds[0]; x < bucketBounds[3]; x++) {
          buffer[(z * bucketSize * bucketSize) + (y * bucketSize) + x] = dataView.getUint8(index++);
        }
      }
    }
    return buffer;
  }


  clampBucketToMaxCoordinates({ position, zoomStep }: { position: Vector3, zoomStep: number}): Vector6 {
    const min = this.lowerBoundary;
    const max = this.upperBoundary;

    const cubeSize = 1 << (BUCKET_SIZE_P + zoomStep);

    const [x, y, z] = position;
    return [
      Math.max(min[0], x),
      Math.max(min[1], y),
      Math.max(min[2], z),
      Math.min(max[0], x + cubeSize),
      Math.min(max[1], y + cubeSize),
      Math.min(max[2], z + cubeSize),
    ];
  }


  getMaxCoordinatesAsBucket(bounds: Vector6, bucket: BucketInfo) {
    // transform bounds in zoom-step-0 voxels to bucket coordinates between 0 and BUCKET_SIZE_P
    const bucketBounds = _.map(bounds, (coordinate) => {
      const cubeSize = 1 << (BUCKET_SIZE_P + bucket.zoomStep);
      return (coordinate % cubeSize) >> bucket.zoomStep;
    });

    // as the upper bound for bucket coordinates is exclusive, the % cubeSize of it is 0
    // but we want it to be 1 << BUCKET_SIZE_P
    for (let i = 3; i <= 5; i++) {
      bucketBounds[i] = bucketBounds[i] || (1 << BUCKET_SIZE_P);
    }

    return bucketBounds;
  }
}


export default NdStoreLayer;
