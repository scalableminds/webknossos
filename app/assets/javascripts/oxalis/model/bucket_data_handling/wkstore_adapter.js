// @flow

import Base64 from "base64-js";
import Request from "libs/request";
import Store from "oxalis/store";
import { pushSaveQueueAction } from "oxalis/model/actions/save_actions";
import { updateBucket } from "oxalis/model/sagas/update_actions";
import * as Utils from "libs/utils";
import { doWithToken } from "admin/admin_rest_api";
import type { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import type { Vector3, Vector4 } from "oxalis/constants";
import type { DataLayerType } from "oxalis/store";
import { getResolutions, isSegmentationLayer } from "oxalis/model/accessors/dataset_accessor.js";
import { bucketPositionToGlobalAddress } from "oxalis/model/helpers/position_converter";
import constants from "oxalis/constants";

export const REQUEST_TIMEOUT = 30000;

export type SendBucketInfo = {
  position: Vector3,
  zoomStep: number,
  cubeSize: number,
};

type RequestBucketInfo = {
  ...SendBucketInfo,
  fourBit: boolean,
};

// Converts a zoomed address ([x, y, z, zoomStep] array) into a bucket JSON
// object as expected by the server on bucket request
const createRequestBucketInfo = (
  zoomedAddress: Vector4,
  resolutions: Array<Vector3>,
  fourBit: boolean,
): RequestBucketInfo => ({
  ...createSendBucketInfo(zoomedAddress, resolutions),
  fourBit,
});

function createSendBucketInfo(zoomedAddress: Vector4, resolutions: Array<Vector3>): SendBucketInfo {
  return {
    position: bucketPositionToGlobalAddress(zoomedAddress, resolutions),
    zoomStep: zoomedAddress[3],
    cubeSize: constants.BUCKET_WIDTH,
  };
}

window.URL = window.URL || window.webkitURL;

function createWorker() {
  // "Server response", used in all examples
  const response = `
  self.onmessage = function(evt) {
    const {url, options, isFourBit, resolverId} = evt.data;
    const headers = new Headers();
    for (const name of Object.keys(options.headers)) {
      headers.set(name, options.headers[name]);
    }
    options.headers = headers;
    fetch(url, options).then(response => response.arrayBuffer()).then((arrayBuffer) => {
      const transform = isFourBit ? decodeFourBit : e => e;
      const decoded = transform(new Uint8Array(arrayBuffer));
      postMessage({resolverId, buffer: decoded.buffer}, [decoded.buffer]);
    })
  }

  function decodeFourBit(bufferArray) {
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
  `;

  const blob = new Blob([response], { type: "application/javascript" });
  const worker = new Worker(URL.createObjectURL(blob));
  return worker;
}
const worker = Blob != null ? createWorker() : {};
const resolverMap = {};
let newestResolverId = 0;
worker.onmessage = e => {
  const { resolverId, buffer } = (e.data: any);
  resolverMap[resolverId](new Uint8Array(buffer));
  resolverMap[resolverId] = undefined;
};

export async function requestFromStore(
  layerInfo: DataLayerType,
  batch: Array<Vector4>,
): Promise<Uint8Array> {
  const fourBit =
    Store.getState().datasetConfiguration.fourBit &&
    !isSegmentationLayer(Store.getState().dataset, layerInfo.name);
  const resolutions = getResolutions(Store.getState().dataset);
  const bucketInfo = batch.map(zoomedAddress =>
    createRequestBucketInfo(zoomedAddress, resolutions, fourBit),
  );

  return doWithToken(async token => {
    const state = Store.getState();
    const datasetName = state.dataset.name;
    const dataStoreUrl = state.dataset.dataStore.url;

    const url = `${dataStoreUrl}/data/datasets/${datasetName}/layers/${
      layerInfo.name
    }/data?token=${token}`;

    if (window.useWebWorker) {
      const options = {
        data: bucketInfo,
        timeout: REQUEST_TIMEOUT,
        method: "POST",
        body: JSON.stringify(bucketInfo),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/octet-stream",
        },
        host: "",
        credentials: "same-origin",
        doNotCatch: false,
        params: null,
      };

      return _request(url, options, fourBit);
    } else {
      const responseBuffer = await Request.sendJSONReceiveArraybuffer(url, {
        data: bucketInfo,
        timeout: REQUEST_TIMEOUT,
      });
      let result = new Uint8Array(responseBuffer);
      if (fourBit) {
        result = decodeFourBit(result);
      }
      return result;
    }
  });
}

function _request(url: string, options: Object, isFourBit: boolean): Promise<Uint8Array> {
  return new Promise((resolve, _reject) => {
    newestResolverId = (newestResolverId + 1) % 2 ** 24;
    resolverMap[newestResolverId] = resolve;
    worker.postMessage({ url, options, isFourBit, resolverId: newestResolverId });
  });
}

function decodeFourBit(bufferArray: Uint8Array): Uint8Array {
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

export async function sendToStore(batch: Array<DataBucket>): Promise<void> {
  const YIELD_AFTER_X_BUCKETS = 3;
  let counter = 0;
  const items = [];
  for (const bucket of batch) {
    counter++;
    // Do not block the main thread for too long as Base64.fromByteArray is performance heavy
    // eslint-disable-next-line no-await-in-loop
    if (counter % YIELD_AFTER_X_BUCKETS === 0) await Utils.sleep(1);
    const bucketData = bucket.getData();
    const bucketInfo = createSendBucketInfo(
      bucket.zoomedAddress,
      getResolutions(Store.getState().dataset),
    );
    items.push(updateBucket(bucketInfo, Base64.fromByteArray(bucketData)));
  }
  Store.dispatch(pushSaveQueueAction(items, "volume"));
}
