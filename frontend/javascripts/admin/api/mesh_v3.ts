import Request from "libs/request";
import { Vector3, Vector4 } from "oxalis/constants";
import { APIDatasetId } from "types/api_flow_types";
import { doWithToken } from "./token";

export type MeshChunk = { position: Vector3; byteOffset: number; byteSize: number };

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
  datasetId: APIDatasetId,
  layerName: string,
  meshFile: string,
  segmentId: number,
  mappingName: string | null | undefined,
  useMeshFromMappedIds: boolean,
): Promise<SegmentInfo> {
  return doWithToken((token) => {
    const params = new URLSearchParams();
    params.append("token", token);
    if (mappingName != null) {
      params.append("mappingName", mappingName);
    }
    params.append("useMeshFromMappedIds", useMeshFromMappedIds ? "true" : "false");
    return Request.sendJSONReceiveJSON(
      `${dataStoreUrl}/data/datasets/${datasetId.owningOrganization}/${datasetId.name}/layers/${layerName}/meshes/formatVersion/3/chunks?${params}`,
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

export function getMeshfileChunkData(
  dataStoreUrl: string,
  datasetId: APIDatasetId,
  layerName: string,
  meshFile: string,
  byteOffset: number,
  byteSize: number,
): Promise<ArrayBuffer> {
  return doWithToken(async (token) => {
    const data = await Request.sendJSONReceiveArraybufferWithHeaders(
      `${dataStoreUrl}/data/datasets/${datasetId.owningOrganization}/${datasetId.name}/layers/${layerName}/meshes/formatVersion/3/chunks/data?token=${token}`,
      {
        data: {
          meshFile,
          byteOffset,
          byteSize,
        },
        useWebworkerForArrayBuffer: false,
      },
    );
    return data;
  });
}
