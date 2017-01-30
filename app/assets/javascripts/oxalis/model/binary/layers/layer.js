/**
 * layer.js
 * @flow weak
 */

import _ from "lodash";
import type { Vector3 } from "oxalis/constants";
import BucketBuilder from "./bucket_builder";
import Request from "../../../../libs/request";

type CategoryType = "color" | "segmentation";
type ElementClassType = string; // TODO: Can/should we be more precise like "uint16" | "Uint32"?

type LayerInfoType = {
  name: string;
  category: CategoryType;
  elementClass: ElementClassType;
}

// Abstract class that defines the Layer interface and implements common
// functionality.
class Layer {
  REQUEST_TIMEOUT: number;
  fourBit: boolean;
  dataStoreInfo: {
    typ: string;
    url: string;
    accessToken: string;
  };
  name: string;
  dataSetName: string;
  bitDepth: number;
  tokenPromise: Promise<string>;
  tokenRequestPromise: ?Promise<string>;
  category: CategoryType;
  elementClass: ElementClassType;
  lowerBoundary: Vector3;
  upperBoundary: Vector3;

  static initClass() {
    this.prototype.REQUEST_TIMEOUT = 10000;
  }


  constructor(layerInfo: LayerInfoType, dataSetName, dataStoreInfo) {
    this.dataSetName = dataSetName;
    this.dataStoreInfo = dataStoreInfo;

    this.name = layerInfo.name;
    this.category = layerInfo.category;
    this.elementClass = layerInfo.elementClass;

    this.bitDepth = parseInt(this.elementClass.substring(4));
    this.tokenPromise = this.requestDataToken();
  }


  requestDataToken() {
    if (this.tokenRequestPromise) { return this.tokenRequestPromise; }

    this.tokenRequestPromise = Request.receiveJSON(
      `/dataToken/generate?dataSetName=${this.dataSetName}&dataLayerName=${this.name}`,
    ).then((dataStore) => {
      this.tokenRequestPromise = null;
      return dataStore.token;
    },
    );

    return this.tokenRequestPromise;
  }


  doWithToken(fn) {
    return this.tokenPromise
        .then(fn)
        .catch((error) => {
          if (error.status === 403) {
            console.warn("Token expired. Requesting new token...");
            this.tokenPromise = this.requestDataToken();
            return this.doWithToken(fn);
          }

          throw error;
        },
        );
  }


  buildBuckets(batch, options) {
    return batch.map(bucketAddress => BucketBuilder.fromZoomedAddress(bucketAddress, options));
  }


  // Requests the data, ensures it has the right tokens and resolves with
  // an UInt8Array.
  requestFromStore(batch, options) {
    return this.doWithToken(token => this.requestFromStoreImpl(this.buildBuckets(batch, options), token),
    );
  }


  // Sends the batch to the store. `getBucketData(zoomedAddress) -> Uint8Array`
  // converts bucket addresses to the data to send to the server.
  sendToStore(batch, getBucketData) {
    return this.doWithToken(token => this.sendToStoreImpl(this.buildBuckets(batch), getBucketData, token),
    );
  }

  // eslint-disable-next-line no-unused-vars
  requestFromStoreImpl(batch, token) {
    throw new Error("Subclass responsibility");
  }


  // eslint-disable-next-line no-unused-vars
  sendToStoreImpl(batch, getBucketData, token) {
    throw new Error("Subclass responsibility");
  }
}
Layer.initClass();


export default Layer;
