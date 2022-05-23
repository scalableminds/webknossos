import type { Vector3 } from "oxalis/constants";
import type { MappingType } from "oxalis/store";
export type IsosurfaceMappingInfo = {
  mappingName: string | null | undefined;
  mappingType: MappingType | null | undefined;
  useDataStore?: boolean | null | undefined;
};
export type LoadAdHocMeshAction = {
  type: "LOAD_AD_HOC_MESH_ACTION";
  cellId: number;
  seedPosition: Vector3;
  mappingInfo?: IsosurfaceMappingInfo;
  layerName?: string;
};
export type LoadPrecomputedMeshAction = {
  type: "LOAD_PRECOMPUTED_MESH_ACTION";
  cellId: number;
  seedPosition: Vector3;
  meshFileName: string;
  layerName?: string;
};
export type SegmentationAction = LoadAdHocMeshAction | LoadPrecomputedMeshAction;
export const loadAdHocMeshAction = (
  cellId: number,
  seedPosition: Vector3,
  mappingInfo?: IsosurfaceMappingInfo,
  layerName?: string,
): LoadAdHocMeshAction => ({
  type: "LOAD_AD_HOC_MESH_ACTION",
  cellId,
  seedPosition,
  mappingInfo,
  layerName,
});
export const loadPrecomputedMeshAction = (
  cellId: number,
  seedPosition: Vector3,
  meshFileName: string,
  layerName?: string,
): LoadPrecomputedMeshAction => ({
  type: "LOAD_PRECOMPUTED_MESH_ACTION",
  cellId,
  seedPosition,
  meshFileName,
  layerName,
});
