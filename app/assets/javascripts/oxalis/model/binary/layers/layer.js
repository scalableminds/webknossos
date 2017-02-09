/**
 * layer.js
 * @flow
 */

import type { Vector3, Vector4 } from "oxalis/constants";
import type { MappingType } from "oxalis/model/binary/mappings";
import BucketBuilder from "oxalis/model/binary/layers/bucket_builder";
import type { BucketInfo } from "oxalis/model/binary/layers/bucket_builder";
import Request from "libs/request";

import type { BoundingBoxObjectType } from "oxalis/model";


export type CategoryType = "color" | "segmentation";
type ElementClassType = string; // TODO: Can/should we be more precise like "uint16" | "Uint32"?

export type DataStoreInfoType = {
  typ: string;
  url: string;
  accessToken: string;
};

export type LayerInfoType = {
  name: string;
  category: CategoryType;
  elementClass: ElementClassType;
  mappings: Array<MappingType>;
  maxCoordinates: BoundingBoxObjectType;
  resolutions: Array<number>;
}

export type BucketRequestOptions = {
  fourBit: boolean;
};

export const REQUEST_TIMEOUT = 10000;

// Abstract class that defines the Layer interface and implements common
// functionality.
class Layer {
  fourBit: boolean;
  dataStoreInfo: DataStoreInfoType;
  name: string;
  dataSetName: string;
  bitDepth: number;
  tokenPromise: Promise<string>;
  tokenRequestPromise: ?Promise<string>;
  category: CategoryType;
  elementClass: ElementClassType;
  lowerBoundary: Vector3;
  upperBoundary: Vector3;
  mappings: Array<MappingType>;
  maxCoordinates: BoundingBoxObjectType;
  resolutions: Array<number>;


  constructor(layerInfo: LayerInfoType, dataSetName: string, dataStoreInfo: DataStoreInfoType) {
    this.dataSetName = dataSetName;
    this.dataStoreInfo = dataStoreInfo;

    this.name = layerInfo.name;
    this.category = layerInfo.category;
    this.elementClass = layerInfo.elementClass;
    this.mappings = layerInfo.mappings;
    this.maxCoordinates = layerInfo.maxCoordinates;
    this.resolutions = layerInfo.resolutions;

    this.bitDepth = parseInt(this.elementClass.substring(4));
    this.tokenPromise = this.requestDataToken();
  }


  requestDataToken(): Promise<string> {
    if (this.tokenRequestPromise) { return this.tokenRequestPromise; }

    this.tokenRequestPromise = Request.receiveJSON(
      `/dataToken/generate?dataSetName=${this.dataSetName}&dataLayerName=${this.name}`,
    ).then((dataStore) => {
      this.tokenRequestPromise = null;
      return dataStore.token;
    });

    return this.tokenRequestPromise;
  }


  doWithToken<T, U>(fn: (token: string) => T): Promise<U> {
    return this.tokenPromise
        .then(fn)
        .catch((error) => {
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
    return this.doWithToken(token => this.requestFromStoreImpl(this.buildBuckets(batch, options), token));
  }


  // Sends the batch to the store. `getBucketData(zoomedAddress) -> Uint8Array`
  // converts bucket addresses to the data to send to the server.
  sendToStore(batch: Array<Vector4>, getBucketData: (Vector4) => Uint8Array): Promise<void> {
    return this.doWithToken(token => this.sendToStoreImpl(this.buildBuckets(batch), getBucketData, token));
  }

  // eslint-disable-next-line no-unused-vars
  requestFromStoreImpl(batch: Array<BucketInfo>, token: string): Promise<Uint8Array> {
    throw new Error("Subclass responsibility");
  }

  // eslint-disable-next-line no-unused-vars
  setFourBit(newFourBit: boolean): void {
    throw new Error("Subclass responsibility");
  }

  // eslint-disable-next-line no-unused-vars
  sendToStoreImpl(batch: Array<BucketInfo>, getBucketData: (Vector4) => Uint8Array, token: string): Promise<void> {
    throw new Error("Subclass responsibility");
  }
}


export default Layer;
