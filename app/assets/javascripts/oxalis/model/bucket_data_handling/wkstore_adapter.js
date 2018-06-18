// @flow

import Base64 from "base64-js";

import BucketBuilder from "oxalis/model/bucket_data_handling/bucket_builder";
import Request from "libs/request";
import Store from "oxalis/store";
import { pushSaveQueueAction } from "oxalis/model/actions/save_actions";
import { updateBucket } from "oxalis/model/sagas/update_actions";
import Utils from "libs/utils";
import { doWithToken } from "admin/admin_rest_api";
import type { BucketInfo } from "oxalis/model/bucket_data_handling/bucket_builder";
import type { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import type { Vector4 } from "oxalis/constants";
import type { DataLayerType } from "oxalis/store";
import { getResolutions } from "oxalis/model/accessors/dataset_accessor.js";

export const REQUEST_TIMEOUT = 30000;

function buildBuckets(layerInfo: DataLayerType, batch: Array<Vector4>): Array<BucketInfo> {
  return batch.map((bucketAddress: Vector4) =>
    BucketBuilder.fromZoomedAddress(bucketAddress, getResolutions(Store.getState().dataset)),
  );
}

export async function requestFromStore(
  layerInfo: DataLayerType,
  batch: Array<Vector4>,
): Promise<Uint8Array> {
  const bucketInfo = buildBuckets(layerInfo, batch);
  return doWithToken(async token => {
    const state = Store.getState();
    const wasFourBit = state.datasetConfiguration.fourBit;
    const datasetName = state.dataset.name;
    const dataStoreUrl = state.dataset.dataStore.url;

    const responseBuffer = await Request.sendJSONReceiveArraybuffer(
      `${dataStoreUrl}/data/datasets/${datasetName}/layers/${layerInfo.name}/data?token=${token}`,
      {
        data: bucketInfo,
        timeout: REQUEST_TIMEOUT,
      },
    );

    let result = new Uint8Array(responseBuffer);
    if (wasFourBit) {
      result = decodeFourBit(result);
    }
    return result;
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
    const bucketInfo = BucketBuilder.fromZoomedAddress(
      bucket.zoomedAddress,
      getResolutions(Store.getState().dataset),
    );
    items.push(updateBucket(bucketInfo, Base64.fromByteArray(bucketData)));
  }
  Store.dispatch(pushSaveQueueAction(items));
}
