import Request from "libs/request";
import type { Vector3, Vector4 } from "oxalis/constants";
import type { APIDataSourceId } from "types/api_flow_types";
import { doWithToken } from "./token";

export type MeshChunk = {
  position: Vector3;
  byteOffset: number;
  byteSize: number;
  unmappedSegmentId: number;
};

type MeshLodInfo = {
  scale: number;
  vertexOffset: Vector3;
  chunkShape: Vector3;
  chunks: Array<MeshChunk>;
};

type MeshSegmentInfo = {
  chunkShape: Vector3;
  gridOrigin: Vector3;
  lods: Array<MeshLodInfo>;
};

type SegmentInfo = {
  transform: [Vector4, Vector4, Vector4]; // 4x3 matrix
  meshFormat: "draco";
  chunks: MeshSegmentInfo;
};

export function getMeshfileChunksForSegment(
  dataStoreUrl: string,
  dataSourceId: APIDataSourceId,
  layerName: string,
  meshFile: string,
  segmentId: number,
  // targetMappingName is the on-disk mapping name.
  // In case of an editable mapping, this should still be the on-disk base
  // mapping name (so that agglomerates that are untouched by the editable
  // mapping can be looked up there without another round-trip between tracingstore
  // and datastore)
  targetMappingName: string | null | undefined,
  // editableMappingTracingId should be the tracing id, not the editable mapping id.
  // If this is set, it is assumed that the request is about an editable mapping.
  editableMappingTracingId: string | null | undefined,
): Promise<SegmentInfo> {
  return doWithToken((token) => {
    const params = new URLSearchParams();
    params.append("token", token);
    if (targetMappingName != null) {
      params.append("targetMappingName", targetMappingName);
    }
    if (editableMappingTracingId != null) {
      params.append("editableMappingTracingId", editableMappingTracingId);
    }
    return Request.sendJSONReceiveJSON(
      `${dataStoreUrl}/data/datasets/${dataSourceId.owningOrganization}/${dataSourceId.directoryName}/layers/${layerName}/meshes/chunks?${params}`,
      {
        data: {
          meshFile,
          segmentId,
        },
        showErrorToast: false,
      },
    );
  });
}

type MeshChunkDataRequest = {
  byteOffset: number;
  byteSize: number;
};

type MeshChunkDataRequestList = {
  meshFile: string;
  requests: MeshChunkDataRequest[];
};

export function getMeshfileChunkData(
  dataStoreUrl: string,
  dataSourceId: APIDataSourceId,
  layerName: string,
  batchDescription: MeshChunkDataRequestList,
): Promise<ArrayBuffer[]> {
  return doWithToken(async (token) => {
    const dracoDataChunks = await Request.sendJSONReceiveArraybuffer(
      `${dataStoreUrl}/data/datasets/${dataSourceId.owningOrganization}/${dataSourceId.directoryName}/layers/${layerName}/meshes/chunks/data?token=${token}`,
      {
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
  });
}
