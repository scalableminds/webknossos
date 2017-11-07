/**
 * layer.js
 * @flow
 */

import Store from "oxalis/store";
import type { Vector3, Vector4 } from "oxalis/constants";
import BucketBuilder from "oxalis/model/binary/layers/bucket_builder";
import { doWithToken } from "admin/admin_rest_api";
import type { BucketInfo } from "oxalis/model/binary/layers/bucket_builder";
import type {
  DataStoreInfoType,
  CategoryType,
  ElementClassType,
  BoundingBoxObjectType,
  DataLayerType,
  MappingType,
} from "oxalis/store";
import type { DataBucket } from "oxalis/model/binary/bucket";

export type BucketRequestOptions = {
  fourBit: boolean,
};

export const REQUEST_TIMEOUT = 30000;

// TODO: Non-reactive
// Abstract class that defines the Layer interface and implements common
// functionality.
class Layer {
  fourBit: boolean;
  dataStoreInfo: DataStoreInfoType;
  name: string;
  bitDepth: number;
  tokenPromise: Promise<string>;
  tokenRequestPromise: ?Promise<string>;
  category: CategoryType;
  elementClass: ElementClassType;
  lowerBoundary: Vector3;
  upperBoundary: Vector3;
  mappings: ?Array<MappingType>;
  boundingBox: BoundingBoxObjectType;
  resolutions: Array<number>;

  constructor(layerInfo: DataLayerType, dataStoreInfo: DataStoreInfoType) {
    this.dataStoreInfo = dataStoreInfo;

    this.name = layerInfo.name;
    this.category = layerInfo.category;
    this.elementClass = layerInfo.elementClass;
    this.mappings = layerInfo.mappings;
    this.boundingBox = layerInfo.boundingBox;
    this.resolutions = layerInfo.resolutions;

    this.bitDepth = parseInt(this.elementClass.substring(4));
  }

  getDatasetName(): string {
    const dataset = Store.getState().dataset;
    if (dataset == null) {
      throw new Error("Dataset needs to be available.");
    }
    return dataset.name;
  }

  buildBuckets(batch: Array<Vector4>, options: ?BucketRequestOptions): Array<BucketInfo> {
    return batch.map(bucketAddress => BucketBuilder.fromZoomedAddress(bucketAddress, options));
  }

  // Requests the data, ensures it has the right tokens and resolves with
  // an UInt8Array.
  requestFromStore(batch: Array<Vector4>, options: ?BucketRequestOptions): Promise<Uint8Array> {
    return doWithToken(token =>
      this.requestFromStoreImpl(this.buildBuckets(batch, options), token),
    );
  }

  // Sends the batch to the store.
  sendToStore(batch: Array<DataBucket>): Promise<void> {
    return this.sendToStoreImpl(batch);
  }

  /* eslint-disable no-unused-vars */
  requestFromStoreImpl(batch: Array<BucketInfo>, token: string): Promise<Uint8Array> {
    throw new Error("Subclass responsibility");
  }

  setFourBit(newFourBit: boolean): void {
    throw new Error("Subclass responsibility");
  }

  sendToStoreImpl(batch: Array<DataBucket>): Promise<void> {
    throw new Error("Subclass responsibility");
  }
  /* eslint-enable no-unused-vars */
}

export default Layer;
