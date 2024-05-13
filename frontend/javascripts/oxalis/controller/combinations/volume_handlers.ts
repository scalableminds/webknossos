import type { OrthoView, Point2, Vector3 } from "oxalis/constants";
import { ContourModeEnum } from "oxalis/constants";
import { calculateGlobalPos } from "oxalis/model/accessors/view_mode_accessor";
import {
  startEditingAction,
  floodFillAction,
  addToLayerAction,
  finishEditingAction,
  setContourTracingModeAction,
  setActiveCellAction,
  resetContourAction,
} from "oxalis/model/actions/volumetracing_actions";
import { Model, Store, api } from "oxalis/singletons";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { type AdditionalCoordinate } from "types/api_flow_types";

export function handleDrawStart(pos: Point2, plane: OrthoView) {
  const state = Store.getState();
  Store.dispatch(setContourTracingModeAction(ContourModeEnum.DRAW));
  Store.dispatch(startEditingAction(calculateGlobalPos(state, pos), plane));
  Store.dispatch(addToLayerAction(calculateGlobalPos(state, pos)));
}
export function handleEraseStart(pos: Point2, plane: OrthoView) {
  Store.dispatch(setContourTracingModeAction(ContourModeEnum.DELETE));
  Store.dispatch(startEditingAction(calculateGlobalPos(Store.getState(), pos), plane));
}
export function handleMoveForDrawOrErase(pos: Point2) {
  const state = Store.getState();
  Store.dispatch(addToLayerAction(calculateGlobalPos(state, pos)));
}
export function handleEndForDrawOrErase() {
  Store.dispatch(finishEditingAction());
  Store.dispatch(resetContourAction());
}
export function handlePickCell(pos: Point2) {
  const storeState = Store.getState();
  const globalPos = calculateGlobalPos(storeState, pos);

  return handlePickCellFromGlobalPosition(globalPos, storeState.flycam.additionalCoordinates || []);
}
export function getSegmentIdForPosition(globalPos: Vector3) {
  // This function will return the currently loaded segment ID for a given position.
  // If the corresponding bucket is not loaded at the moment, the return value will be 0.
  // See getSegmentIdForPositionAsync if the bucket loading should be awaited before returning the ID.
  const layer = Model.getVisibleSegmentationLayer();
  const { additionalCoordinates } = Store.getState().flycam;

  if (!layer) {
    return 0;
  }

  const segmentationCube = layer.cube;
  const segmentationLayerName = layer.name;
  const renderedZoomStepForCameraPosition = api.data.getRenderedZoomStepAtPosition(
    segmentationLayerName,
    globalPos,
  );
  return segmentationCube.getMappedDataValue(
    globalPos,
    additionalCoordinates,
    renderedZoomStepForCameraPosition,
  );
}
export async function getSegmentIdForPositionAsync(globalPos: Vector3) {
  // This function will return the segment ID for a given position, awaiting the loading
  // of the corresponding bucket.
  // See getSegmentIdForPosition if the bucket loading should not be awaited.
  const layer = Model.getVisibleSegmentationLayer();
  const { additionalCoordinates } = Store.getState().flycam;

  if (!layer) {
    return 0;
  }

  const segmentationCube = layer.cube;
  const segmentationLayerName = layer.name;
  const renderedZoomStepForCameraPosition = await api.data.getUltimatelyRenderedZoomStepAtPosition(
    segmentationLayerName,
    globalPos,
  );
  // Make sure the corresponding bucket is loaded
  await api.data.getDataValue(
    segmentationLayerName,
    globalPos,
    renderedZoomStepForCameraPosition,
    additionalCoordinates,
  );
  return segmentationCube.getMappedDataValue(
    globalPos,
    additionalCoordinates,
    renderedZoomStepForCameraPosition,
  );
}
export function handlePickCellFromGlobalPosition(
  globalPos: Vector3,
  additionalCoordinates: AdditionalCoordinate[],
) {
  const segmentId = getSegmentIdForPosition(globalPos);

  if (segmentId > 0) {
    Store.dispatch(setActiveCellAction(segmentId, globalPos, additionalCoordinates));
  }
}
export function handleFloodFill(pos: Point2, plane: OrthoView) {
  const globalPos = calculateGlobalPos(Store.getState(), pos);
  handleFloodFillFromGlobalPosition(globalPos, plane);
}
export function handleFloodFillFromGlobalPosition(globalPos: Vector3, plane: OrthoView) {
  Store.dispatch(floodFillAction(globalPos, plane));
}
const MAX_BRUSH_CHANGE_VALUE = 5;
const BRUSH_CHANGING_CONSTANT = 0.02;
export function changeBrushSizeIfBrushIsActiveBy(factor: number) {
  const currentBrushSize = Store.getState().userConfiguration.brushSize;
  const newBrushSize =
    Math.min(Math.ceil(currentBrushSize * BRUSH_CHANGING_CONSTANT), MAX_BRUSH_CHANGE_VALUE) *
      factor +
    currentBrushSize;
  Store.dispatch(updateUserSettingAction("brushSize", newBrushSize));
}
