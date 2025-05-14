import type { AdditionalCoordinate } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import type { MappingType } from "viewer/store";

export type AdHocMeshInfo = {
  mappingName: string | null | undefined;
  mappingType: MappingType | null | undefined;
  useDataStore?: boolean | null | undefined;
  preferredQuality?: number | null | undefined;
};
export type LoadAdHocMeshAction = ReturnType<typeof loadAdHocMeshAction>;
export type LoadPrecomputedMeshAction = ReturnType<typeof loadPrecomputedMeshAction>;

export type SegmentationAction = LoadAdHocMeshAction | LoadPrecomputedMeshAction;

export const loadAdHocMeshAction = (
  segmentId: number,
  seedPosition: Vector3,
  seedAdditionalCoordinates: AdditionalCoordinate[] | undefined | null,
  extraInfo?: AdHocMeshInfo,
  layerName?: string,
) =>
  ({
    type: "LOAD_AD_HOC_MESH_ACTION",
    segmentId,
    seedPosition,
    seedAdditionalCoordinates,
    extraInfo,
    layerName,
  }) as const;

export const loadPrecomputedMeshAction = (
  segmentId: number,
  seedPosition: Vector3,
  seedAdditionalCoordinates: AdditionalCoordinate[] | undefined | null,
  meshFileName: string,
  opacity?: number,
  layerName?: string | undefined,
) =>
  ({
    type: "LOAD_PRECOMPUTED_MESH_ACTION",
    segmentId,
    seedPosition,
    seedAdditionalCoordinates,
    meshFileName,
    opacity,
    layerName,
  }) as const;
