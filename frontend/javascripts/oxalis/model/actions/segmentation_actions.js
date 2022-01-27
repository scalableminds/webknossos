// @flow

import type { Vector3 } from "oxalis/constants";

export type LoadAdHocMeshAction = {
  type: "LOAD_AD_HOC_MESH_ACTION",
  cellId: number,
  seedPosition: Vector3,
  layerName?: string,
};

export type SegmentationAction = LoadAdHocMeshAction;

export const loadAdHocMeshAction = (
  cellId: number,
  seedPosition: Vector3,
  layerName?: string,
): LoadAdHocMeshAction => ({
  type: "LOAD_AD_HOC_MESH_ACTION",
  cellId,
  seedPosition,
  layerName,
});
