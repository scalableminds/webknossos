// @flow
/* eslint-disable import/prefer-default-export */

export type ChangeActiveIsosurfaceCellAction = {
  type: "CHANGE_ACTIVE_ISOSURFACE_CELL",
  cellId: number,
};

export type IsosurfaceAction = ChangeActiveIsosurfaceCellAction;

export const changeActiveIsosurfaceCellAction = (
  cellId: number,
): ChangeActiveIsosurfaceCellAction => ({
  type: "CHANGE_ACTIVE_ISOSURFACE_CELL",
  cellId,
});
