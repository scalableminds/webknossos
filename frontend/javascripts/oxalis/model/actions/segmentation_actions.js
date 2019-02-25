// @flow
/* eslint-disable import/prefer-default-export */

import type { Vector3 } from "oxalis/constants";

export type ChangeActiveIsosurfaceCellAction = {
  type: "CHANGE_ACTIVE_ISOSURFACE_CELL",
  cellId: number,
  seedPosition: Vector3,
};

export type IsosurfaceAction = ChangeActiveIsosurfaceCellAction;

export const changeActiveIsosurfaceCellAction = (
  cellId: number,
  seedPosition: Vector3,
): ChangeActiveIsosurfaceCellAction => ({
  type: "CHANGE_ACTIVE_ISOSURFACE_CELL",
  cellId,
  seedPosition,
});
