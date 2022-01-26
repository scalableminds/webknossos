// @flow

import type { Vector3 } from "oxalis/constants";

export type ChangeActiveIsosurfaceCellAction = {
  type: "CHANGE_ACTIVE_ISOSURFACE_CELL",
  cellId: number,
  seedPosition: Vector3,
  layerName?: string,
};

export type IsosurfaceAction = ChangeActiveIsosurfaceCellAction;

export const changeActiveIsosurfaceCellAction = (
  cellId: number,
  seedPosition: Vector3,
  layerName?: string,
): ChangeActiveIsosurfaceCellAction => ({
  type: "CHANGE_ACTIVE_ISOSURFACE_CELL",
  cellId,
  seedPosition,
  layerName,
});
