/**
 * volumetracing_plane_controller.js
 * @flow
 */

import { ContourModeEnum, type OrthoView, type Point2, type Vector3 } from "oxalis/constants";
import { calculateGlobalPos } from "oxalis/model/accessors/view_mode_accessor";
import {
  startEditingAction,
  floodFillAction,
  addToLayerAction,
  finishEditingAction,
  setContourTracingModeAction,
  inferSegmentationInViewportAction,
  setActiveCellAction,
  resetContourAction,
} from "oxalis/model/actions/volumetracing_actions";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { getResolutionInfoOfSegmentationLayer } from "oxalis/model/accessors/dataset_accessor";
import Model from "oxalis/model";
import Store from "oxalis/store";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";

// TODO: Build proper UI for this
window.isAutomaticBrushEnabled = false;
export function isAutomaticBrushEnabled() {
  return (
    window.isAutomaticBrushEnabled || Store.getState().temporaryConfiguration.isAutoBrushEnabled
  );
}

export function handleDrawStart(pos: Point2, plane: OrthoView) {
  Store.dispatch(setContourTracingModeAction(ContourModeEnum.DRAW));
  Store.dispatch(startEditingAction(calculateGlobalPos(Store.getState(), pos), plane));
}

export function handleEraseStart(pos: Point2, plane: OrthoView) {
  Store.dispatch(setContourTracingModeAction(ContourModeEnum.DELETE));
  Store.dispatch(startEditingAction(calculateGlobalPos(Store.getState(), pos), plane));
}

export function handleDrawDeleteMove(pos: Point2) {
  const state = Store.getState();
  Store.dispatch(addToLayerAction(calculateGlobalPos(state, pos)));
  Store.dispatch(addToLayerAction(calculateGlobalPos(state, pos)));
}

export function handleDrawEraseEnd() {
  Store.dispatch(finishEditingAction());
  Store.dispatch(resetContourAction());
}

export function handlePickCell(pos: Point2) {
  const storeState = Store.getState();
  const globalPos = calculateGlobalPos(storeState, pos);
  return handlePickCellFromGlobalPosition(globalPos);
}

export function getCellFromGlobalPosition(globalPos: Vector3): number {
  const segmentation = Model.getSegmentationLayer();
  if (!segmentation) {
    return 0;
  }

  const storeState = Store.getState();
  const logZoomStep = getRequestLogZoomStep(storeState);
  const resolutionInfo = getResolutionInfoOfSegmentationLayer(storeState.dataset);
  const existingZoomStep = resolutionInfo.getClosestExistingIndex(logZoomStep);

  const cellId = segmentation.cube.getMappedDataValue(globalPos, existingZoomStep);
  return cellId;
}

export function handlePickCellFromGlobalPosition(globalPos: Vector3) {
  const cellId = getCellFromGlobalPosition(globalPos);
  if (cellId > 0) {
    Store.dispatch(setActiveCellAction(cellId));
  }
}

export function handleFloodFill(pos: Point2, plane: OrthoView) {
  Store.dispatch(floodFillAction(calculateGlobalPos(Store.getState(), pos), plane));
}

export function handleAutoBrush(pos: Point2) {
  if (!isAutomaticBrushEnabled()) {
    return;
  }
  Store.dispatch(inferSegmentationInViewportAction(calculateGlobalPos(Store.getState(), pos)));
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
