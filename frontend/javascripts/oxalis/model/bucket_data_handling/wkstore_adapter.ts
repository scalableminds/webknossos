import type { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import { bucketPositionToGlobalAddress } from "oxalis/model/helpers/position_converter";
import { createWorker } from "oxalis/workers/comlink_wrapper";
import { doWithToken } from "admin/admin_rest_api";
import {
  isSegmentationLayer,
  getByteCountFromLayer,
  getMappingInfo,
  getResolutionInfo,
} from "oxalis/model/accessors/dataset_accessor";
import { getVolumeTracingById } from "oxalis/model/accessors/volumetracing_accessor";
import { parseAsMaybe } from "libs/utils";
import { pushSaveQueueTransaction } from "oxalis/model/actions/save_actions";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import { updateBucket } from "oxalis/model/sagas/update_actions";
import ByteArrayToLz4Base64Worker from "oxalis/workers/byte_array_to_lz4_base64.worker";
import DecodeFourBitWorker from "oxalis/workers/decode_four_bit.worker";
import ErrorHandling from "libs/error_handling";
import Request from "libs/request";
import type { DataLayerType, VolumeTracing } from "oxalis/store";
import Store from "oxalis/store";
import WorkerPool from "libs/worker_pool";
import type { Vector3, Vector4 } from "oxalis/constants";
import constants, { MappingStatusEnum } from "oxalis/constants";
import window from "libs/window";
import { getGlobalDataConnectionInfo } from "../data_connection_info";
import { ResolutionInfo } from "../helpers/resolution_info";

const decodeFourBit = createWorker(DecodeFourBitWorker);
const COMPRESSION_WORKER_COUNT = 2;
const compressionPool = new WorkerPool(
  () => createWorker(ByteArrayToLz4Base64Worker),
  COMPRESSION_WORKER_COUNT,
);
export const REQUEST_TIMEOUT = 60000;
export type SendBucketInfo = {
  position: Vector3;
  mag: Vector3;
  cubeSize: number;
};
type RequestBucketInfo = SendBucketInfo & {
  fourBit: boolean;
  applyAgglomerate?: string;
  version?: number;
};

// Converts a zoomed address ([x, y, z, zoomStep] array) into a bucket JSON
// object as expected by the server on bucket request
const createRequestBucketInfo = (
  zoomedAddress: Vector4,
  resolutionInfo: ResolutionInfo,
  fourBit: boolean,
  applyAgglomerate: string | null | undefined,
  version: number | null | undefined,
): RequestBucketInfo => ({
  ...createSendBucketInfo(zoomedAddress, resolutionInfo),
  fourBit,
  ...(applyAgglomerate != null
    ? {
        applyAgglomerate,
      }
    : {}),
  ...(version != null
    ? {
        version,
      }
    : {}),
});

function createSendBucketInfo(
  zoomedAddress: Vector4,
  resolutionInfo: ResolutionInfo,
): SendBucketInfo {
  return {
    position: bucketPositionToGlobalAddress(zoomedAddress, resolutionInfo),
    mag: resolutionInfo.getResolutionByIndexOrThrow(zoomedAddress[3]),
    cubeSize: constants.BUCKET_WIDTH,
  };
}

function getNullIndices<T>(arr: Array<T | null | undefined>): Array<number> {
  return arr.map((el, idx) => (el != null ? -1 : idx)).filter((idx) => idx > -1);
}

export async function requestWithFallback(
  layerInfo: DataLayerType,
  batch: Array<Vector4>,
): Promise<Array<Uint8Array | null | undefined>> {
  const state = Store.getState();
  const datasetName = state.dataset.name;
  const organization = state.dataset.owningOrganization;
  const dataStoreHost = state.dataset.dataStore.url;
  const tracingStoreHost = state.tracing.tracingStore.url;

  const getDataStoreUrl = (optLayerName?: string) =>
    `${dataStoreHost}/data/datasets/${organization}/${datasetName}/layers/${
      optLayerName || layerInfo.name
    }`;

  const getTracingStoreUrl = () => `${tracingStoreHost}/tracings/volume/${layerInfo.name}`;

  const maybeVolumeTracing =
    "tracingId" in layerInfo && layerInfo.tracingId != null
      ? getVolumeTracingById(state.tracing, layerInfo.tracingId)
      : null;
  // For non-segmentation layers and for viewing datasets, we'll always use the datastore URL
  const shouldUseDataStore = maybeVolumeTracing == null;
  const requestUrl = shouldUseDataStore ? getDataStoreUrl() : getTracingStoreUrl();
  const bucketBuffers = await requestFromStore(requestUrl, layerInfo, batch, maybeVolumeTracing);
  const missingBucketIndices = getNullIndices(bucketBuffers);

  // If buckets could not be found on the tracing store (e.g. this happens when the buckets
  // were not annotated yet), they are instead looked up in the fallback layer
  // on the tracing store.
  // This retry mechanism is only active for volume tracings with fallback layers without
  // editable mappings (aka proofreading).
  const retry =
    missingBucketIndices.length > 0 &&
    maybeVolumeTracing != null &&
    maybeVolumeTracing.fallbackLayer != null &&
    !maybeVolumeTracing.mappingIsEditable;

  if (!retry) {
    return bucketBuffers;
  }

  if (maybeVolumeTracing == null) {
    // Satisfy typescript
    return bucketBuffers;
  }

  // Request missing buckets from the datastore as a fallback
  const fallbackBatch = missingBucketIndices.map((idx) => batch[idx]);
  const fallbackBuffers = await requestFromStore(
    getDataStoreUrl(maybeVolumeTracing.fallbackLayer),
    layerInfo,
    fallbackBatch,
    maybeVolumeTracing,
    true,
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
  maybeVolumeTracing: VolumeTracing | null | undefined,
  isVolumeFallback: boolean = false,
): Promise<Array<Uint8Array | null | undefined>> {
  const state = Store.getState();
  const isSegmentation = isSegmentationLayer(state.dataset, layerInfo.name);
  const fourBit = state.datasetConfiguration.fourBit && !isSegmentation;
  const activeMapping = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    layerInfo.name,
  );
  const applyAgglomerates =
    isSegmentation &&
    activeMapping != null && // Start to request mapped data during mapping activation phase already
    activeMapping.mappingStatus !== MappingStatusEnum.DISABLED &&
    activeMapping.mappingType === "HDF5"
      ? activeMapping.mappingName
      : null;
  const resolutionInfo = getResolutionInfo(layerInfo.resolutions);
  const version =
    !isVolumeFallback && isSegmentation && maybeVolumeTracing != null
      ? maybeVolumeTracing.version
      : null;
  const bucketInfo = batch.map((zoomedAddress) =>
    createRequestBucketInfo(zoomedAddress, resolutionInfo, fourBit, applyAgglomerates, version),
  );

  try {
    return await doWithToken(async (token) => {
      const startingTime = window.performance.now();
      const { buffer: responseBuffer, headers } =
        await Request.sendJSONReceiveArraybufferWithHeaders(`${dataUrl}/data?token=${token}`, {
          data: bucketInfo,
          timeout: REQUEST_TIMEOUT,
          showErrorToast: false,
        });
      const endTime = window.performance.now();
      const missingBuckets = parseAsMaybe(headers["missing-buckets"]).getOrElse([]);
      const receivedBucketsCount = batch.length - missingBuckets.length;
      const BUCKET_BYTE_LENGTH = constants.BUCKET_SIZE * getByteCountFromLayer(layerInfo);
      getGlobalDataConnectionInfo().log(
        startingTime,
        endTime,
        receivedBucketsCount * BUCKET_BYTE_LENGTH,
      );
      let resultBuffer = responseBuffer;

      if (fourBit) {
        resultBuffer = await decodeFourBit(resultBuffer);
      }

      return sliceBufferIntoPieces(layerInfo, batch, missingBuckets, new Uint8Array(resultBuffer));
    });
  } catch (errorResponse) {
    const errorMessage = `Requesting data from layer "${layerInfo.name}" failed. Some rendered areas might remain empty. Retrying...`;
    const detailedError =
      // @ts-ignore
      errorResponse.status != null
        ? // @ts-ignore
          `Status code ${errorResponse.status} - "${errorResponse.statusText}" - URL: ${errorResponse.url}.`
        : // @ts-ignore
          errorResponse.message;
    console.error(`${errorMessage} ${detailedError}`);
    console.error(errorResponse);
    ErrorHandling.notify(new Error(errorMessage), {
      detailedError,
      isOnline: window.navigator.onLine,
    });
    return batch.map((_val) => null);
  }
}

function sliceBufferIntoPieces(
  layerInfo: DataLayerType,
  batch: Array<Vector4>,
  missingBuckets: Array<number>,
  buffer: Uint8Array,
): Array<Uint8Array | null | undefined> {
  let offset = 0;
  const BUCKET_BYTE_LENGTH = constants.BUCKET_SIZE * getByteCountFromLayer(layerInfo);
  const bucketBuffers = batch.map((_bucketAddress, index) => {
    const isMissing = missingBuckets.indexOf(index) > -1;
    const subbuffer = isMissing ? null : buffer.subarray(offset, (offset += BUCKET_BYTE_LENGTH));
    return subbuffer;
  });
  return bucketBuffers;
}

export async function sendToStore(batch: Array<DataBucket>, tracingId: string): Promise<void> {
  const items: Array<UpdateAction> = await Promise.all(
    batch.map(async (bucket): Promise<UpdateAction> => {
      const data = bucket.getCopyOfData();
      const bucketInfo = createSendBucketInfo(bucket.zoomedAddress, bucket.cube.resolutionInfo);
      const byteArray = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const compressedBase64 = await compressionPool.submit(byteArray);
      return updateBucket(bucketInfo, compressedBase64);
    }),
  );
  Store.dispatch(pushSaveQueueTransaction(items, "volume", tracingId));
}
