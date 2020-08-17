// @flow
import { type OrthoView, type Point2 } from "oxalis/constants";
import Model from "oxalis/model";
import { changeActiveIsosurfaceCellAction } from "oxalis/model/actions/segmentation_actions";
import { calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import Store from "oxalis/store";

function isosurfaceLeftClick(pos: Point2, plane: OrthoView, event: MouseEvent) {
  if (!event.shiftKey) {
    return;
  }
  const segmentation = Model.getSegmentationLayer();
  if (!segmentation) {
    return;
  }
  const position = calculateGlobalPos(pos);
  const cellId = segmentation.cube.getMappedDataValue(
    position,
    getRequestLogZoomStep(Store.getState()),
  );
  if (cellId > 0) {
    Store.dispatch(changeActiveIsosurfaceCellAction(cellId, position));
  }
}

export default isosurfaceLeftClick;
