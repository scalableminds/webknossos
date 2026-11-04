import { type ApiResult, type RetryOptions, requestResult } from "admin/api/api_result";
import type { RequestOptions } from "libs/request";
import Request from "libs/request";
import type { APIMeshFileInfo } from "types/api_types";
import type { Vector3, Vector4 } from "viewer/constants";
import { doWithToken } from "./token";

export type MeshChunk = {
  position: Vector3;
  byteOffset: number;
  byteSize: number;
  unmappedSegmentId: bigint;
};

export type MeshLodInfo = {
  chunks: Array<MeshChunk>;
  transform: [Vector4, Vector4, Vector4]; // 4x3 matrix
};

export type MeshSegmentInfo = {
  meshFormat: "draco";
  lods: Array<MeshLodInfo>;
  chunkScale: Vector3;
};

type ListMeshChunksRequest = {
  meshFileName: string;
  segmentId: bigint;
  annotationVersion: number | undefined | null;
};

// Mesh requests are potentially heavy for the data store. Therefore, retries should not
// follow each other too quickly (2s, 4s, 8s).
const MESH_RETRY_OPTIONS: RetryOptions = {
  retries: 3,
  initialDelayMs: 2000,
  backoffFactor: 2,
  maxDelayMs: 8000,
};

export function getMeshFileChunksForSegment(
  dataStoreUrl: string,
  datasetId: string,
  layerName: string,
  meshFile: APIMeshFileInfo,
  segmentId: bigint,
  // targetMappingName is the on-disk mapping name.
  // In case of an editable mapping, this should still be the on-disk base
  // mapping name (so that agglomerates that are untouched by the editable
  // mapping can be looked up there without another round-trip between tracingstore
  // and datastore)
  targetMappingName: string | null | undefined,
  // editableMappingTracingId should be the tracing id, not the editable mapping id.
  // If this is set, it is assumed that the request is about an editable mapping.
  editableMappingTracingId: string | null | undefined,
  annotationVersion: number | undefined | null,
  options: RequestOptions = {},
  retryOptions: RetryOptions = MESH_RETRY_OPTIONS,
): Promise<ApiResult<MeshSegmentInfo>> {
  return requestResult(
    (adaptedOptions) =>
      doWithToken((token) => {
        const params = new URLSearchParams();
        params.append("token", token);
        if (targetMappingName != null) {
          params.append("targetMappingName", targetMappingName);
        }
        if (editableMappingTracingId != null) {
          params.append("editableMappingTracingId", editableMappingTracingId);
        }
        const payload: ListMeshChunksRequest = {
          meshFileName: meshFile.name,
          segmentId,
          annotationVersion,
        };
        return Request.sendJSONReceiveJSON(
          `${dataStoreUrl}/data/datasets/${datasetId}/layers/${layerName}/meshes/chunks?${params}`,
          {
            ...adaptedOptions,
            data: payload,
          },
        );
      }),
    // The callers are responsible for surfacing the final error (see getMeshFileChunkData).
    { showErrorToast: false, ...options },
    retryOptions,
  );
}

type MeshChunkDataRequest = {
  byteOffset: number;
  byteSize: number;
  segmentId: bigint | null; // Only relevant for neuroglancer precomputed meshes
};

export type MeshChunkDataRequestList = {
  meshFileName: string;
  requests: MeshChunkDataRequest[];
};

export function getMeshFileChunkData(
  dataStoreUrl: string,
  datasetId: string,
  layerName: string,
  batchDescription: MeshChunkDataRequestList,
  options: RequestOptions = {},
  retryOptions: RetryOptions = MESH_RETRY_OPTIONS,
): Promise<ApiResult<ArrayBuffer[]>> {
  return requestResult(
    (adaptedOptions) =>
      doWithToken(async (token) => {
        const dracoDataChunks = await Request.sendJSONReceiveArraybuffer(
          `${dataStoreUrl}/data/datasets/${datasetId}/layers/${layerName}/meshes/chunks/data?token=${token}`,
          {
            ...adaptedOptions,
            data: batchDescription,
            useWebworkerForArrayBuffer: true,
          },
        );
        const chunkCount = batchDescription.requests.length;
        const jumpPositionsForChunks = [];
        let cumsum = 0;
        for (const req of batchDescription.requests) {
          jumpPositionsForChunks.push(cumsum);
          cumsum += req.byteSize;
        }
        jumpPositionsForChunks.push(cumsum);

        const dataEntries = [];
        for (let chunkIdx = 0; chunkIdx < chunkCount; chunkIdx++) {
          // slice() creates a copy of the data, but working with TypedArray Views would cause
          // issues when transferring the data to a webworker.
          const dracoData = dracoDataChunks.slice(
            jumpPositionsForChunks[chunkIdx],
            jumpPositionsForChunks[chunkIdx + 1],
          );
          dataEntries.push(dracoData);
        }

        return dataEntries;
      }),
    // Failed attempts are retried and the callers are responsible for surfacing the
    // final error, so don't show a toast.
    { showErrorToast: false, ...options },
    retryOptions,
  );
}
