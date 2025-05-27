import { doWithToken } from "admin/rest_api";
import ErrorHandling from "libs/error_handling";
import Request from "libs/request";
import { parseMaybe } from "libs/utils";
import WebworkerPool from "libs/webworker_pool";
import window from "libs/window";
import _ from "lodash";
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
import type { UpdateActionWithoutIsolationRequirement } from "viewer/model/sagas/update_actions";
import { updateBucket } from "viewer/model/sagas/update_actions";
import type { DataLayerType, VolumeTracing } from "viewer/store";
import Store from "viewer/store";
import ByteArraysToLz4Base64Worker from "viewer/workers/byte_arrays_to_lz4_base64.worker";
import { createWorker } from "viewer/workers/comlink_wrapper";
import DecodeFourBitWorker from "viewer/workers/decode_four_bit.worker";
import { getGlobalDataConnectionInfo } from "../data_connection_info";
import type { MagInfo } from "../helpers/mag_info";

const decodeFourBit = createWorker(DecodeFourBitWorker);

// For 32-bit buckets with 32^3 voxels, a COMPRESSION_BATCH_SIZE of
// 128 corresponds to 16.8 MB that are sent to a webworker in one
// go.
const COMPRESSION_BATCH_SIZE = 128;
const COMPRESSION_WORKER_COUNT = 2;
const compressionPool = new WebworkerPool(
  () => createWorker(ByteArraysToLz4Base64Worker),
  COMPRESSION_WORKER_COUNT,
);

export const REQUEST_TIMEOUT = 60000;

export type SendBucketInfo = {
  position: Vector3;
  additionalCoordinates: Array<AdditionalCoordinate> | null | undefined;
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

function getNullIndices<T>(arr: Array<T | null | undefined>): Array<number> {
  return arr.map((el, idx) => (el != null ? -1 : idx)).filter((idx) => idx > -1);
}

export async function requestWithFallback(
  layerInfo: DataLayerType,
  batch: Array<BucketAddress>,
): Promise<Array<Uint8Array<ArrayBuffer> | null | undefined>> {
  const state = Store.getState();
  const datasetDirectoryName = state.dataset.directoryName;
  const organization = state.dataset.owningOrganization;
  const dataStoreHost = state.dataset.dataStore.url;
  const tracingStoreHost = state.annotation.tracingStore.url;

  const getDataStoreUrl = (optLayerName?: string) =>
    `${dataStoreHost}/data/datasets/${organization}/${datasetDirectoryName}/layers/${
      optLayerName || layerInfo.name
    }`;

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
  const bucketBuffers = await requestFromStore(
    requestUrl,
    layerInfo,
    batch,
    maybeVolumeTracing,
    maybeVolumeTracing != null ? state.annotation.annotationId : undefined,
  );
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
    !maybeVolumeTracing.hasEditableMapping;

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
    maybeVolumeTracing != null ? state.annotation.annotationId : undefined,
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
  batch: Array<BucketAddress>,
  maybeVolumeTracing: VolumeTracing | null | undefined,
  maybeAnnotationId: string | undefined,
  isVolumeFallback: boolean = false,
): Promise<Array<Uint8Array<ArrayBuffer> | null | undefined>> {
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
      activeMapping.mappingType === "HDF5"
      ? activeMapping.mappingName
      : null;
  })();

  const magInfo = getMagInfo(layerInfo.resolutions);
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
      const missingBuckets = (parseMaybe(headers["missing-buckets"]) || []) as number[];
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
    throw errorResponse;
  }
}

function sliceBufferIntoPieces(
  layerInfo: DataLayerType,
  batch: Array<BucketAddress>,
  missingBuckets: Array<number>,
  buffer: Uint8Array<ArrayBuffer>,
): Array<Uint8Array<ArrayBuffer> | null | undefined> {
  let offset = 0;
  const BUCKET_BYTE_LENGTH = constants.BUCKET_SIZE * getByteCountFromLayer(layerInfo);
  const bucketBuffers = batch.map((_bucketAddress, index) => {
    const isMissing = missingBuckets.indexOf(index) > -1;
    const subbuffer = isMissing ? null : buffer.subarray(offset, (offset += BUCKET_BYTE_LENGTH));
    return subbuffer;
  });
  return bucketBuffers;
}

export async function createCompressedUpdateBucketActions(
  batch: Array<DataBucket>,
): Promise<UpdateActionWithoutIsolationRequirement[]> {
  return _.flatten(
    await Promise.all(
      _.chunk(batch, COMPRESSION_BATCH_SIZE).map(async (batchSubset) => {
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
    ),
  );
}
