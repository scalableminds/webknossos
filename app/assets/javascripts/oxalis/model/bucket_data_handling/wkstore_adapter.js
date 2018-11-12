// @flow

import type { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import { bucketPositionToGlobalAddress } from "oxalis/model/helpers/position_converter";
import { createWorker } from "oxalis/workers/comlink_wrapper";
import { doWithToken } from "admin/admin_rest_api";
import { enforceVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import {
  getResolutions,
  isSegmentationLayer,
  getByteCountFromLayer,
} from "oxalis/model/accessors/dataset_accessor";
import { parseAsMaybe } from "libs/utils";
import { pushSaveQueueAction } from "oxalis/model/actions/save_actions";
import { updateBucket } from "oxalis/model/sagas/update_actions";
import ByteArrayToBase64Worker from "oxalis/workers/byte_array_to_base64.worker";
import DecodeFourBitWorker from "oxalis/workers/decode_four_bit.worker";
import Request from "libs/request";
import Store, { type DataLayerType } from "oxalis/store";
import constants, { type Vector3, type Vector4 } from "oxalis/constants";

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
  version: ?number,
};

// Converts a zoomed address ([x, y, z, zoomStep] array) into a bucket JSON
// object as expected by the server on bucket request
const createRequestBucketInfo = (
  zoomedAddress: Vector4,
  resolutions: Array<Vector3>,
  fourBit: boolean,
  version: ?number,
): RequestBucketInfo => ({
  ...createSendBucketInfo(zoomedAddress, resolutions),
  fourBit,
  ...(version != null ? { version } : {}),
});

function createSendBucketInfo(zoomedAddress: Vector4, resolutions: Array<Vector3>): SendBucketInfo {
  return {
    position: bucketPositionToGlobalAddress(zoomedAddress, resolutions),
    zoomStep: zoomedAddress[3],
    cubeSize: constants.BUCKET_WIDTH,
  };
}

function getNullIndices<T>(arr: Array<?T>): Array<number> {
  return arr.map((el, idx) => (el != null ? -1 : idx)).filter(idx => idx > -1);
}

export async function requestWithFallback(
  layerInfo: DataLayerType,
  batch: Array<Vector4>,
): Promise<Array<?Uint8Array>> {
  const state = Store.getState();
  const datasetName = state.dataset.name;
  const organization = state.dataset.owningOrganization;
  const dataStoreHost = state.dataset.dataStore.url;
  const tracingStoreHost = state.tracing.tracingStore.url;
  const isSegmentation = isSegmentationLayer(state.dataset, layerInfo.name);

  const getDataStoreUrl = (optLayerName?: string) =>
    `${dataStoreHost}/data/datasets/${organization}/${datasetName}/layers/${optLayerName ||
      layerInfo.name}`;
  const getTracingStoreUrl = () => `${tracingStoreHost}/tracings/volume/${layerInfo.name}`;

  // For non-segmentation layers and for viewing datasets, we'll always use the datastore URL
  const shouldUseDataStore = !isSegmentation || state.tracing.volume == null;
  const requestUrl = shouldUseDataStore ? getDataStoreUrl() : getTracingStoreUrl();

  const bucketBuffers = await requestFromStore(requestUrl, layerInfo, batch).catch(() =>
    batch.map(() => null),
  );
  const missingBucketIndices = getNullIndices(bucketBuffers);

  const retry =
    !shouldUseDataStore &&
    missingBucketIndices.length > 0 &&
    enforceVolumeTracing(state.tracing).fallbackLayer != null;
  if (!retry) {
    return bucketBuffers;
  }

  // Request missing buckets from the datastore as a fallback
  const fallbackBatch = missingBucketIndices.map(idx => batch[idx]);
  const fallbackBuffers = await requestFromStore(
    getDataStoreUrl(enforceVolumeTracing(state.tracing).fallbackLayer),
    layerInfo,
    fallbackBatch,
  );

  return bucketBuffers.map((bucket, idx) => {
    if (bucket != null) {
      return bucket;
    } else {
      const fallbackIdx = missingBucketIndices.indexOf(idx);
      return fallbackBuffers[fallbackIdx];
    }
  });
}

export async function requestFromStore(
  dataUrl: string,
  layerInfo: DataLayerType,
  batch: Array<Vector4>,
): Promise<Array<?Uint8Array>> {
  const state = Store.getState();
  const isSegmentation = isSegmentationLayer(state.dataset, layerInfo.name);
  const fourBit = state.datasetConfiguration.fourBit && !isSegmentation;
  const resolutions = getResolutions(state.dataset);
  const version =
    isSegmentation && state.tracing.volume != null ? state.tracing.volume.version : null;
  const bucketInfo = batch.map(zoomedAddress =>
    createRequestBucketInfo(zoomedAddress, resolutions, fourBit, version),
  );

  return doWithToken(async token => {
    const { buffer: responseBuffer, headers } = await Request.sendJSONReceiveArraybufferWithHeaders(
      `${dataUrl}/data?token=${token}`,
      {
        data: bucketInfo,
        timeout: REQUEST_TIMEOUT,
      },
    );
    const missingBuckets = parseAsMaybe(headers["missing-buckets"]).getOrElse([]);

    let resultBuffer = responseBuffer;
    if (fourBit) {
      resultBuffer = await decodeFourBit(resultBuffer);
    }

    return sliceBufferIntoPieces(layerInfo, batch, missingBuckets, new Uint8Array(resultBuffer));
  });
}

function sliceBufferIntoPieces(
  layerInfo: DataLayerType,
  batch: Array<Vector4>,
  missingBuckets: Array<number>,
  buffer: Uint8Array,
): Array<?Uint8Array> {
  let offset = 0;
  const BUCKET_LENGTH = constants.BUCKET_SIZE * getByteCountFromLayer(layerInfo);

  const bucketBuffers = batch.map((_bucketAddress, index) => {
    const isMissing = missingBuckets.indexOf(index) > -1;
    const subbuffer = isMissing ? null : buffer.subarray(offset, (offset += BUCKET_LENGTH));
    return subbuffer;
  });

  return bucketBuffers;
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
