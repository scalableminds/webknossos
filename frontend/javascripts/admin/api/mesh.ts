import { toBigInt } from "libs/bigint_helpers";
import Request from "libs/request";
import { retryAsyncFunction } from "libs/utils";
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

// The raw shapes mirror the JSON as it comes over the wire, before unmappedSegmentId
// (an unsigned-decimal string or, for legacy payloads, a plain number) is normalized to bigint.
type RawMeshChunk = Omit<MeshChunk, "unmappedSegmentId"> & {
  unmappedSegmentId?: string | number | null;
};
type RawMeshLodInfo = Omit<MeshLodInfo, "chunks"> & { chunks: Array<RawMeshChunk> };
type RawMeshSegmentInfo = Omit<MeshSegmentInfo, "lods"> & { lods: Array<RawMeshLodInfo> };

type ListMeshChunksRequest = {
  meshFileName: string;
  segmentId: bigint;
  annotationVersion: number | undefined | null;
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
): Promise<MeshSegmentInfo> {
  return retryAsyncFunction(async () => {
    const rawSegmentInfo = await doWithToken<RawMeshSegmentInfo>((token) => {
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
          data: payload,
          showErrorToast: false,
        },
      );
    });
    return {
      ...rawSegmentInfo,
      lods: rawSegmentInfo.lods.map((lod) => ({
        ...lod,
        chunks: lod.chunks.map((chunk) => ({
          ...chunk,
          unmappedSegmentId:
            chunk.unmappedSegmentId != null ? toBigInt(chunk.unmappedSegmentId) : 0n,
        })),
      })),
    };
  });
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
): Promise<ArrayBuffer[]> {
  return retryAsyncFunction(() =>
    doWithToken(async (token) => {
      const dracoDataChunks = await Request.sendJSONReceiveArraybuffer(
        `${dataStoreUrl}/data/datasets/${datasetId}/layers/${layerName}/meshes/chunks/data?token=${token}`,
        {
          data: batchDescription,
          useWebworkerForArrayBuffer: true,
          // Failed attempts are retried (see retryAsyncFunction above) and the
          // callers are responsible for surfacing the final error, so don't
          // show a toast for each failed attempt.
          showErrorToast: false,
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
  );
}
