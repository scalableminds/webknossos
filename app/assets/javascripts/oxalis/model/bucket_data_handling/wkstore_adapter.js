// @flow

import Request from "libs/request";
import Store from "oxalis/store";
import { pushSaveQueueAction } from "oxalis/model/actions/save_actions";
import { updateBucket } from "oxalis/model/sagas/update_actions";
import { doWithToken } from "admin/admin_rest_api";
import type { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import type { Vector3, Vector4 } from "oxalis/constants";
import type { DataLayerType } from "oxalis/store";
import { getResolutions, isSegmentationLayer } from "oxalis/model/accessors/dataset_accessor";
import { bucketPositionToGlobalAddress } from "oxalis/model/helpers/position_converter";
import constants from "oxalis/constants";
import { createWorker } from "oxalis/workers/comlink_wrapper";
import DecodeFourBitWorker from "oxalis/workers/decode_four_bit.worker";
import ByteArrayToBase64Worker from "oxalis/workers/byte_array_to_base64.worker";

const decodeFourBit = createWorker(DecodeFourBitWorker);
const byteArrayToBase64 = createWorker(ByteArrayToBase64Worker);

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

export async function requestFromStore(
  layerInfo: DataLayerType,
  batch: Array<Vector4>,
): Promise<{ buffer: Uint8Array, missingBuckets: number[] }> {
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

    const { buffer: responseBuffer, headers } = await Request.sendJSONReceiveArraybufferWithHeaders(
      `${dataStoreUrl}/data/datasets/${datasetName}/layers/${layerInfo.name}/data?token=${token}`,
      {
        data: bucketInfo,
        timeout: REQUEST_TIMEOUT,
      },
    );
    const missingBuckets = JSON.parse(headers["missing-buckets"]);

    let resultBuffer = responseBuffer;
    if (fourBit) {
      resultBuffer = await decodeFourBit(resultBuffer);
    }
    return { buffer: new Uint8Array(resultBuffer), missingBuckets };
  });
}

export async function sendToStore(batch: Array<DataBucket>): Promise<void> {
  const items = [];
  for (const bucket of batch) {
    const bucketData = bucket.getData();
    const bucketInfo = createSendBucketInfo(
      bucket.zoomedAddress,
      getResolutions(Store.getState().dataset),
    );
    // eslint-disable-next-line no-await-in-loop
    const base64 = await byteArrayToBase64(bucketData);
    items.push(updateBucket(bucketInfo, base64));
  }
  Store.dispatch(pushSaveQueueAction(items, "volume"));
}
