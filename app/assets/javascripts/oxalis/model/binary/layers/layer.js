/**
 * layer.js
 * @flow
 */

import Store from "oxalis/store";
import type { Vector3, Vector4 } from "oxalis/constants";
import BucketBuilder from "oxalis/model/binary/layers/bucket_builder";
import type { BucketInfo } from "oxalis/model/binary/layers/bucket_builder";
import Request from "libs/request";
import type {
  DataStoreInfoType,
  CategoryType,
  ElementClassType,
  BoundingBoxObjectType,
  DataLayerType,
  MappingType,
} from "oxalis/store";

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
  mappings: Array<MappingType>;
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
    this.tokenPromise = this.requestDataToken();
  }

  getDatasetName(): string {
    const dataset = Store.getState().dataset;
    if (dataset == null) {
      throw new Error("Dataset needs to be available.");
    }
    return dataset.name;
  }

  requestDataToken(): Promise<string> {
    if (this.tokenRequestPromise) {
      return this.tokenRequestPromise;
    }

    const datasetName = this.getDatasetName();
    this.tokenRequestPromise = Request.receiveJSON(
      `/dataToken/generate?dataSetName=${datasetName}&dataLayerName=${this.name}`,
    ).then(dataStore => {
      this.tokenRequestPromise = null;
      return dataStore.token;
    });

    return this.tokenRequestPromise;
  }

  doWithToken<T>(fn: (token: string) => T): Promise<*> {
    return this.tokenPromise.then(fn).catch(error => {
      if (error.status === 403) {
        console.warn("Token expired. Requesting new token...");
        this.tokenPromise = this.requestDataToken();
        return this.doWithToken(fn);
      }
      throw error;
    });
  }

  buildBuckets(batch: Array<Vector4>, options: ?BucketRequestOptions): Array<BucketInfo> {
    return batch.map(bucketAddress => BucketBuilder.fromZoomedAddress(bucketAddress, options));
  }

  // Requests the data, ensures it has the right tokens and resolves with
  // an UInt8Array.
  requestFromStore(batch: Array<Vector4>, options: ?BucketRequestOptions): Promise<Uint8Array> {
    return this.doWithToken(token =>
      this.requestFromStoreImpl(this.buildBuckets(batch, options), token),
    );
  }

  // Sends the batch to the store. `getBucketData(zoomedAddress) -> Uint8Array`
  // converts bucket addresses to the data to send to the server.
  sendToStore(batch: Array<Vector4>, getBucketData: Vector4 => Uint8Array): Promise<void> {
    return this.doWithToken(token =>
      this.sendToStoreImpl(this.buildBuckets(batch), getBucketData, token),
    );
  }

  /* eslint-disable no-unused-vars */
  requestFromStoreImpl(batch: Array<BucketInfo>, token: string): Promise<Uint8Array> {
    throw new Error("Subclass responsibility");
  }

  setFourBit(newFourBit: boolean): void {
    throw new Error("Subclass responsibility");
  }

  sendToStoreImpl(
    batch: Array<BucketInfo>,
    getBucketData: Vector4 => Uint8Array,
    token: string,
  ): Promise<void> {
    throw new Error("Subclass responsibility");
  }
  /* eslint-enable no-unused-vars */
}

export default Layer;
