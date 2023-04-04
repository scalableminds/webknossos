import type { Vector3 } from "oxalis/constants";
import type { MappingType } from "oxalis/store";
export type AdHocIsosurfaceInfo = {
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
  extraInfo?: AdHocIsosurfaceInfo,
  layerName?: string,
) =>
  ({
    type: "LOAD_AD_HOC_MESH_ACTION",
    segmentId,
    seedPosition,
    extraInfo,
    layerName,
  } as const);

export const loadPrecomputedMeshAction = (
  segmentId: number,
  seedPosition: Vector3,
  meshFileName: string,
  layerName?: string,
) =>
  ({
    type: "LOAD_PRECOMPUTED_MESH_ACTION",
    segmentId,
    seedPosition,
    meshFileName,
    layerName,
  } as const);
