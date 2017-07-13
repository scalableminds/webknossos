/**
 * wk_layer.js
 * @flow
 */

import Base64 from "base64-js";

import Layer, { REQUEST_TIMEOUT } from "oxalis/model/binary/layers/layer";
import type { BucketRequestOptions } from "oxalis/model/binary/layers/layer";
import BucketBuilder from "oxalis/model/binary/layers/bucket_builder";
import type { BucketInfo } from "oxalis/model/binary/layers/bucket_builder";
import Request from "libs/request";
import type { Vector4 } from "oxalis/constants";
import type { DataLayerType, DataStoreInfoType } from "oxalis/store";

// TODO: Non-reactive
class WkLayer extends Layer {

  constructor(layerInfo: DataLayerType, dataStoreInfo: DataStoreInfoType) {
    super(layerInfo, dataStoreInfo);

    if (this.dataStoreInfo.typ !== "webknossos-store") {
      throw new Error("WkLayer should only be instantiated with webknossos-store");
    }

    this.fourBit = false;
  }


  setFourBit(newFourBit: boolean) {
    // No op if this is not a color layer
    if (this.category === "color") {
      this.fourBit = newFourBit;
    }
  }


  buildBuckets(batch: Array<Vector4>, options: ?BucketRequestOptions) {
    if (options == null) {
      options = { fourBit: this.fourBit };
    } else {
      options.fourBit = this.fourBit;
    }
    return super.buildBuckets(batch, options);
  }


  async requestFromStoreImpl(batch: Array<BucketInfo>, token: string): Promise<Uint8Array> {
    const wasFourBit = this.fourBit;

    const datasetName = this.getDatasetName();
    const responseBuffer = await Request.sendJSONReceiveArraybuffer(
      `${this.dataStoreInfo.url}/data/datasets/${datasetName}/layers/${this.name}/data?token=${token}`,
      {
        data: batch,
        timeout: REQUEST_TIMEOUT,
        doNotCatch: true,
      });

    let result = new Uint8Array(responseBuffer);
    if (wasFourBit) {
      result = this.decodeFourBit(result);
    }
    return result;
  }


  decodeFourBit(bufferArray: Uint8Array): Uint8Array {
    // Expand 4-bit data
    const newColors = new Uint8Array(bufferArray.length << 1);

    let index = 0;
    while (index < newColors.length) {
      const value = bufferArray[index >> 1];
      newColors[index] = value & 0b11110000;
      index++;
      newColors[index] = value << 4;
      index++;
    }

    return newColors;
  }


  async sendToStoreImpl(batch: Array<BucketInfo>, getBucketData: (Vector4) => Uint8Array, token: string): Promise<void> {
    const data = batch.map((bucket) => {
      const bucketData = getBucketData(BucketBuilder.bucketToZoomedAddress(bucket));
      const bucketWithData = { ...bucket, base64Data: Base64.fromByteArray(bucketData) }
      return { action: "labelVolume", value: bucketWithData };
    });

    const datasetName = this.getDatasetName();
    await Request.sendJSONReceiveJSON(
      `${this.dataStoreInfo.url}/data/tracings/volumes/${this.name}?dataSetName=${datasetName}&token=${token}`, {
        method: "POST",
        data,
        timeout: REQUEST_TIMEOUT,
        compress: true,
        doNotCatch: true,
      },
    );
  }
}


export default WkLayer;
