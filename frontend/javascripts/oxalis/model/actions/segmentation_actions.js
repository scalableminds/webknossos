// @flow

import type { Vector3 } from "oxalis/constants";

export type ChangeActiveIsosurfaceCellAction = {
  type: "CHANGE_ACTIVE_ISOSURFACE_CELL",
  cellId: number,
  seedPosition: Vector3,
  shouldReload: boolean,
};

export type IsosurfaceAction = ChangeActiveIsosurfaceCellAction;

export const changeActiveIsosurfaceCellAction = (
  cellId: number,
  seedPosition: Vector3,
  shouldReload: boolean,
): ChangeActiveIsosurfaceCellAction => ({
  type: "CHANGE_ACTIVE_ISOSURFACE_CELL",
  cellId,
  seedPosition,
  shouldReload,
});
