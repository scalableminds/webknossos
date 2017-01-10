import _ from "lodash";
import Layer from "./layer";
import BucketBuilder from "./bucket_builder";
import Request from "../../../../libs/request";
import MultipartData from "../../../../libs/multipart_data";


class WkLayer extends Layer {


  constructor(...args) {
    super(...args);

    if (this.dataStoreInfo.typ !== "webknossos-store") {
      throw new Error("WkLayer should only be instantiated with webknossos-store");
    }

    this.fourBit = false;
  }


  setFourBit(newFourBit) {
    // No op if this is not a color layer
    if (this.category === "color") {
      return this.fourBit = newFourBit;
    }
  }


  buildBuckets(batch, options = {}) {
    options = _.extend(options, { fourBit: this.fourBit });
    return super.buildBuckets(batch, options);
  }


  requestFromStoreImpl(batch, token) {
    const wasFourBit = this.fourBit;
    const requestData = new MultipartData();

    for (const bucket of batch) {
      requestData.addPart({
        "X-Bucket": JSON.stringify(bucket),
      });
    }

    return requestData.dataPromise().then(data => Request.sendArraybufferReceiveArraybuffer(
        `${this.dataStoreInfo.url}/data/datasets/${this.dataSetName}/layers/${this.name}/data?token=${token}`,
      {
        data,
        headers: {
          "Content-Type": `multipart/mixed; boundary=${requestData.boundary}`,
        },
        timeout: this.REQUEST_TIMEOUT,
        compress: true,
        doNotCatch: true,
      },
      ),
    ).then((responseBuffer) => {
      let result = new Uint8Array(responseBuffer);
      if (wasFourBit) {
        result = this.decodeFourBit(result);
      }
      return result;
    },
    );
  }


  decodeFourBit(bufferArray) {
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


  sendToStoreImpl(batch, getBucketData, token) {
    const transmitData = new MultipartData();

    for (const bucket of batch) {
      transmitData.addPart(
        { "X-Bucket": JSON.stringify(bucket) },
        getBucketData(BucketBuilder.bucketToZoomedAddress(bucket)));
    }

    return transmitData.dataPromise().then(data => Request.sendArraybufferReceiveArraybuffer(
        `${this.dataStoreInfo.url}/data/datasets/${this.dataSetName}/layers/${this.name}/data?token=${token}`, {
          method: "PUT",
          data,
          headers: {
            "Content-Type": `multipart/mixed; boundary=${transmitData.boundary}`,
          },
          timeout: this.REQUEST_TIMEOUT,
          compress: true,
          doNotCatch: true,
        },
      ),
    );
  }
}


export default WkLayer;
