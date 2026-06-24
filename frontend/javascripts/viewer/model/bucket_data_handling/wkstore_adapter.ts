import { doWithToken } from "admin/rest_api";
import ErrorHandling from "libs/error_handling";
import Request from "libs/request";
import { parseMaybe } from "libs/utils";
import WebworkerPool from "libs/webworker_pool";
import window from "libs/window";
import chunk from "lodash-es/chunk";
import type { AdditionalCoordinate } from "types/api_types";
import type { BucketAddress, Vector3 } from "viewer/constants";
import constants, { MappingStatusEnum } from "viewer/constants";
import {
  getByteCountFromLayer,
  getMagInfo,
  getMappingInfo,
  isSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import {
  getVolumeTracingById,
  needsLocalHdf5Mapping,
} from "viewer/model/accessors/volumetracing_accessor";
import type { DataBucket } from "viewer/model/bucket_data_handling/bucket";
import { bucketPositionToGlobalAddress } from "viewer/model/helpers/position_converter";
import type { UpdateActionWithoutIsolationRequirement } from "viewer/model/sagas/volume/update_actions";
import { updateBucket } from "viewer/model/sagas/volume/update_actions";
import type { DataLayerType, VolumeTracing } from "viewer/store";
import Store from "viewer/store";
import { createWorker } from "viewer/workers/comlink_wrapper";
import type ByteArraysToLz4Base64 from "../../workers/byte_arrays_to_lz4_base64.worker";
import type DecodeFourBit from "../../workers/decode_four_bit.worker";
import { getGlobalDataConnectionInfo } from "../data_connection_info";
import type { MagInfo } from "../helpers/mag_info";

const decodeFourBit = createWorker<typeof DecodeFourBit>("decode_four_bit.worker.ts");

// For 32-bit buckets with 32^3 voxels, a COMPRESSION_BATCH_SIZE of
// 128 corresponds to 16.8 MB that are sent to a webworker in one
// go.
const COMPRESSION_BATCH_SIZE = 128;
const COMPRESSION_WORKER_COUNT = 2;
const compressionPool = new WebworkerPool(
  () => createWorker<typeof ByteArraysToLz4Base64>("byte_arrays_to_lz4_base64.worker.ts"),
  COMPRESSION_WORKER_COUNT,
);

const REQUEST_TIMEOUT = 60000;

export type SendBucketInfo = {
  position: Vector3;
  additionalCoordinates: Array<AdditionalCoordinate> | null | undefined;
  mag: Vector3;
  cubeSize: number;
};
export type RequestBucketInfo = SendBucketInfo & {
  fourBit: boolean;
  applyAgglomerate?: string;
  version?: number;
};

// Converts a zoomed address ([x, y, z, zoomStep] array) into a bucket JSON
// object as expected by the server on bucket request
const createRequestBucketInfo = (
  zoomedAddress: BucketAddress,
  magInfo: MagInfo,
  fourBit: boolean,
  applyAgglomerate: string | null | undefined,
  version: number | null | undefined,
): RequestBucketInfo => ({
  ...createSendBucketInfo(zoomedAddress, magInfo),
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

function createSendBucketInfo(zoomedAddress: BucketAddress, magInfo: MagInfo): SendBucketInfo {
  return {
    position: bucketPositionToGlobalAddress(zoomedAddress, magInfo),
    additionalCoordinates: zoomedAddress[4],
    mag: magInfo.getMagByIndexOrThrow(zoomedAddress[3]),
    cubeSize: constants.BUCKET_WIDTH,
  };
}

// The outcome of requesting a single bucket. Previously a bucket buffer was
// either present or null/undefined ("missing"). The backend now distinguishes
// genuinely empty buckets (no data, e.g. not annotated yet) from buckets that
// could not be read (failures), which have to be retried.
export type BucketRequestResult =
  | { type: "data"; data: Uint8Array<ArrayBuffer> }
  | { type: "empty" }
  | { type: "failure" };

export async function requestWithFallback(
  layerInfo: DataLayerType,
  batch: Array<BucketAddress>,
): Promise<Array<BucketRequestResult>> {
  const state = Store.getState();
  const datasetId = state.dataset.id;
  const dataStoreHost = state.dataset.dataStore.url;
  const tracingStoreHost = state.annotation.tracingStore.url;

  const getDataStoreUrl = (optLayerName?: string) =>
    `${dataStoreHost}/data/datasets/${datasetId}/layers/${optLayerName || layerInfo.name}`;
  const getTracingStoreUrl = () => `${tracingStoreHost}/tracings/volume/${layerInfo.name}`;

  const maybeVolumeTracing =
    "tracingId" in layerInfo && layerInfo.tracingId != null
      ? getVolumeTracingById(state.annotation, layerInfo.tracingId)
      : null;

  // For non-segmentation layers and for viewing datasets, we'll always use the datastore URL.
  // We also use the data store, if an hdf5 mapping should be locally applied. This is only the
  // case if the proofreading tool is active or the layer was already proofread. In that case,
  // no bucket data changes can exist on the tracing store.
  const shouldUseDataStore =
    maybeVolumeTracing == null || needsLocalHdf5Mapping(state, layerInfo.name);

  const requestUrl = shouldUseDataStore
    ? getDataStoreUrl(maybeVolumeTracing?.fallbackLayer)
    : getTracingStoreUrl();
  const bucketResults = await requestFromStore(
    requestUrl,
    layerInfo,
    batch,
    maybeVolumeTracing,
    maybeVolumeTracing != null ? state.annotation.annotationId : undefined,
  );
  // Only empty buckets are eligible for the fallback lookup below. A failure must not be
  // replaced by fallback-layer data, since that data would lack the annotated changes.
  const emptyBucketIndices = bucketResults
    .map((result, idx) => (result.type === "empty" ? idx : -1))
    .filter((idx) => idx > -1);

  // If buckets could not be found on the tracing store (e.g. this happens when the buckets
  // were not annotated yet), they are instead looked up in the fallback layer
  // on the tracing store.
  // This retry mechanism is only active for volume tracings with fallback layers without
  // editable mappings (aka proofreading).
  const retry =
    emptyBucketIndices.length > 0 &&
    maybeVolumeTracing != null &&
    maybeVolumeTracing.fallbackLayer != null &&
    !maybeVolumeTracing.hasEditableMapping;

  if (!retry) {
    return bucketResults;
  }

  // Request empty buckets from the datastore as a fallback
  const fallbackBatch = emptyBucketIndices.map((idx) => batch[idx]);
  const fallbackResults = await requestFromStore(
    getDataStoreUrl(maybeVolumeTracing.fallbackLayer),
    layerInfo,
    fallbackBatch,
    maybeVolumeTracing,
    maybeVolumeTracing != null ? state.annotation.annotationId : undefined,
    true,
  );
  return bucketResults.map((result, idx) => {
    if (result.type === "empty") {
      const fallbackIdx = emptyBucketIndices.indexOf(idx);
      return fallbackResults[fallbackIdx];
    } else {
      // data and failure results are kept as they are
      return result;
    }
  });
}
async function requestFromStore(
  dataUrl: string,
  layerInfo: DataLayerType,
  batch: Array<BucketAddress>,
  maybeVolumeTracing: VolumeTracing | null | undefined,
  maybeAnnotationId: string | undefined,
  isVolumeFallback: boolean = false,
): Promise<Array<BucketRequestResult>> {
  const state = Store.getState();
  const isSegmentation = isSegmentationLayer(state.dataset, layerInfo.name);
  const fourBit = state.datasetConfiguration.fourBit && !isSegmentation;

  // Mappings can be applied in the frontend or on the server.
  const agglomerateMappingNameToApplyOnServer = (() => {
    if (!isSegmentation) {
      return null;
    }
    if (needsLocalHdf5Mapping(state, layerInfo.name)) {
      return null;
    }
    const activeMapping = getMappingInfo(
      state.temporaryConfiguration.activeMappingByLayer,
      layerInfo.name,
    );
    return activeMapping != null && // Start to request mapped data during mapping activation phase already
      activeMapping.mappingStatus !== MappingStatusEnum.DISABLED &&
      activeMapping.mappingType !== "JSON"
      ? activeMapping.mappingName
      : null;
  })();

  const magInfo = getMagInfo(layerInfo.mags);
  const version =
    !isVolumeFallback && isSegmentation && maybeVolumeTracing != null
      ? state.annotation.version
      : null;
  const bucketInfo = batch.map((zoomedAddress) =>
    createRequestBucketInfo(
      zoomedAddress,
      magInfo,
      fourBit,
      agglomerateMappingNameToApplyOnServer,
      version,
    ),
  );

  try {
    return await doWithToken(async (token) => {
      const startingTime = window.performance.now();
      const params = new URLSearchParams({
        token,
      });
      if (maybeAnnotationId != null) {
        params.append("annotationId", maybeAnnotationId);
      }
      const { buffer: responseBuffer, headers } =
        await Request.sendJSONReceiveArraybufferWithHeaders(`${dataUrl}/data?${params}`, {
          data: bucketInfo,
          timeout: REQUEST_TIMEOUT,
          showErrorToast: false,
        });
      const endTime = window.performance.now();
      // The backend reports empty buckets (no data) and failure buckets (could not be read)
      // in separate headers. Older datastores only send the combined legacy header, in which
      // case all reported indices are treated as empty (the previous behavior).
      const emptyHeader = parseMaybe(headers["empty-bucket-indices"]) as number[] | null;
      const failureHeader = parseMaybe(headers["failure-bucket-indices"]) as number[] | null;
      const usesLegacyHeader = emptyHeader == null && failureHeader == null;
      const emptyBuckets = usesLegacyHeader
        ? ((parseMaybe(headers["missing-buckets"]) || []) as number[])
        : emptyHeader || [];
      const failureBuckets = usesLegacyHeader ? [] : failureHeader || [];

      const receivedBucketsCount = batch.length - emptyBuckets.length - failureBuckets.length;
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

      return sliceBufferIntoPieces(
        layerInfo,
        batch,
        emptyBuckets,
        failureBuckets,
        new Uint8Array(resultBuffer),
      );
    });
  } catch (errorResponse) {
    const errorMessage = `Requesting data from layer "${layerInfo.name}" failed. Some rendered areas might remain empty. Retrying...`;
    const detailedError =
      // @ts-expect-error
      errorResponse.status != null
        ? // @ts-expect-error
          `Status code ${errorResponse.status} - "${errorResponse.statusText}" - URL: ${errorResponse.url}.`
        : // @ts-expect-error
          errorResponse.message;
    console.error(`${errorMessage} ${detailedError}`);
    console.error(errorResponse);
    ErrorHandling.notify(new Error(errorMessage), {
      detailedError,
      isOnline: window.navigator.onLine,
    });
    throw errorResponse;
  }
}

function sliceBufferIntoPieces(
  layerInfo: DataLayerType,
  batch: Array<BucketAddress>,
  emptyBuckets: Array<number>,
  failureBuckets: Array<number>,
  buffer: Uint8Array<ArrayBuffer>,
): Array<BucketRequestResult> {
  const BUCKET_BYTE_LENGTH = constants.BUCKET_SIZE * getByteCountFromLayer(layerInfo);
  // Both empty and failure buckets are excluded from the byte stream by the backend.
  const availableBucketCount = batch.length - emptyBuckets.length - failureBuckets.length;
  const expectedTotalByteLength = availableBucketCount * BUCKET_BYTE_LENGTH;
  if (expectedTotalByteLength !== buffer.length) {
    throw new Error(
      `Expected ${expectedTotalByteLength} bytes, but received ${buffer.length}. Rejecting buckets.`,
    );
  }
  const emptySet = new Set(emptyBuckets);
  const failureSet = new Set(failureBuckets);
  let offset = 0;
  const bucketResults = batch.map((_bucketAddress, index): BucketRequestResult => {
    if (failureSet.has(index)) {
      return { type: "failure" };
    }
    if (emptySet.has(index)) {
      return { type: "empty" };
    }
    return { type: "data", data: buffer.subarray(offset, (offset += BUCKET_BYTE_LENGTH)) };
  });
  return bucketResults;
}

export async function createCompressedUpdateBucketActions(
  batch: Array<DataBucket>,
): Promise<UpdateActionWithoutIsolationRequirement[]> {
  return (
    await Promise.all(
      chunk(batch, COMPRESSION_BATCH_SIZE).map(async (batchSubset) => {
        const byteArrays = batchSubset.map((bucket) => {
          const data = bucket.getCopyOfData();
          return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        });

        const compressedBase64Strings = await compressionPool.submit(byteArrays);
        return compressedBase64Strings.map((compressedBase64, index) => {
          const bucket = batchSubset[index];
          const bucketInfo = createSendBucketInfo(bucket.zoomedAddress, bucket.cube.magInfo);
          return updateBucket(bucketInfo, compressedBase64, bucket.getTracingId());
        });
      }),
    )
  ).flat();
}
