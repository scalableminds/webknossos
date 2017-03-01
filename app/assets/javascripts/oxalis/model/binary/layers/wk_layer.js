/**
 * wk_layer.js
 * @flow
 */

import Store from "oxalis/store";
import Layer, { REQUEST_TIMEOUT } from "oxalis/model/binary/layers/layer";
import type { BucketRequestOptions, LayerInfoType, DataStoreInfoType } from "oxalis/model/binary/layers/layer";
import BucketBuilder from "oxalis/model/binary/layers/bucket_builder";
import type { BucketInfo } from "oxalis/model/binary/layers/bucket_builder";
import Request from "libs/request";
import MultipartData from "libs/multipart_data";
import type { Vector4 } from "oxalis/constants";

class WkLayer extends Layer {

  constructor(layerInfo: LayerInfoType, dataStoreInfo: DataStoreInfoType) {
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
    const requestData = new MultipartData();

    for (const bucket of batch) {
      requestData.addPart({
        "X-Bucket": JSON.stringify(bucket),
      });
    }

    const datasetName = Store.getState().dataset.name;
    const data = await requestData.dataPromise();
    const responseBuffer = await Request.sendArraybufferReceiveArraybuffer(
      `${this.dataStoreInfo.url}/data/datasets/${datasetName}/layers/${this.name}/data?token=${token}`,
      {
        data,
        headers: {
          "Content-Type": `multipart/mixed; boundary=${requestData.boundary}`,
        },
        timeout: REQUEST_TIMEOUT,
        compress: true,
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
    const transmitData = new MultipartData();

    for (const bucket of batch) {
      transmitData.addPart(
        { "X-Bucket": JSON.stringify(bucket) },
        getBucketData(BucketBuilder.bucketToZoomedAddress(bucket)));
    }

    const datasetName = Store.getState().dataset.name;
    const data = await transmitData.dataPromise();
    await Request.sendArraybufferReceiveArraybuffer(
      `${this.dataStoreInfo.url}/data/datasets/${datasetName}/layers/${this.name}/data?token=${token}`, {
        method: "PUT",
        data,
        headers: {
          "Content-Type": `multipart/mixed; boundary=${transmitData.boundary}`,
        },
        timeout: REQUEST_TIMEOUT,
        compress: true,
        doNotCatch: true,
      },
    );
  }
}


export default WkLayer;
