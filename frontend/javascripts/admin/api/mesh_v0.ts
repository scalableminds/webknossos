import Request from "libs/request";
import { Vector3 } from "oxalis/constants";
import { APIDatasetId } from "types/api_flow_types";
import { doWithToken } from "./token";

export function getMeshfileChunksForSegment(
  dataStoreUrl: string,
  datasetId: APIDatasetId,
  layerName: string,
  meshFile: string,
  segmentId: number,
): Promise<Array<Vector3>> {
  return doWithToken((token) => {
    const params = new URLSearchParams();
    params.append("token", token);
    return Request.sendJSONReceiveJSON(
      `${dataStoreUrl}/data/datasets/${datasetId.owningOrganization}/${datasetId.name}/layers/${layerName}/meshes/chunks?${params}`,
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
  segmentId: number,
  position: Vector3,
): Promise<ArrayBuffer> {
  return doWithToken(async (token) => {
    const data = await Request.sendJSONReceiveArraybufferWithHeaders(
      `${dataStoreUrl}/data/datasets/${datasetId.owningOrganization}/${datasetId.name}/layers/${layerName}/meshes/chunks/data?token=${token}`,
      {
        data: {
          meshFile,
          segmentId,
          position,
        },
        useWebworkerForArrayBuffer: false,
      },
    );
    return data;
  });
}
