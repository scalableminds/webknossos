/**
 * volumetracing_plane_controller.js
 * @flow
 */

import _ from "lodash";

import {
  ContourModeEnum,
  type OrthoView,
  OrthoViews,
  type Point2,
  AnnotationToolEnum,
} from "oxalis/constants";
import { calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";
import {
  createCellAction,
  setToolAction,
  startEditingAction,
  floodFillAction,
  addToLayerAction,
  finishEditingAction,
  hideBrushAction,
  setContourTracingModeAction,
  cycleToolAction,
  copySegmentationLayerAction,
  inferSegmentationInViewportAction,
  setActiveCellAction,
  resetContourAction,
} from "oxalis/model/actions/volumetracing_actions";
import { getPosition, getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { getResolutionInfoOfSegmentationLayer } from "oxalis/model/accessors/dataset_accessor";
import {
  getContourTracingMode,
  enforceVolumeTracing,
} from "oxalis/model/accessors/volumetracing_accessor";
import { movePlaneFlycamOrthoAction, setPositionAction } from "oxalis/model/actions/flycam_actions";
import Model from "oxalis/model";
import Store from "oxalis/store";
import * as Utils from "libs/utils";

// TODO: Build proper UI for this
window.isAutomaticBrushEnabled = false;
export function isAutomaticBrushEnabled() {
  return (
    window.isAutomaticBrushEnabled || Store.getState().temporaryConfiguration.isAutoBrushEnabled
  );
}

export function getKeyboardControls() {
  return {
    c: () => Store.dispatch(createCellAction()),
    w: () => {
      Store.dispatch(cycleToolAction());
    },
    "1": () => {
      Store.dispatch(cycleToolAction());
    },
    v: () => {
      Store.dispatch(copySegmentationLayerAction());
    },
    "shift + v": () => {
      Store.dispatch(copySegmentationLayerAction(true));
    },
  };
}

export function handlePickCell(pos: Point2) {
  const segmentation = Model.getSegmentationLayer();
  if (!segmentation) {
    return;
  }
  const storeState = Store.getState();
  const logZoomStep = getRequestLogZoomStep(storeState);
  const resolutionInfo = getResolutionInfoOfSegmentationLayer(storeState.dataset);
  const existingZoomStep = resolutionInfo.getClosestExistingIndex(logZoomStep);

  const cellId = segmentation.cube.getMappedDataValue(calculateGlobalPos(pos), existingZoomStep);
  if (cellId > 0) {
    Store.dispatch(setActiveCellAction(cellId));
  }
}

export function handleFloodFill(pos: Point2, plane: OrthoView) {
  Store.dispatch(floodFillAction(calculateGlobalPos(pos), plane));
}

export function handleAutoBrush(pos: Point2) {
  if (!isAutomaticBrushEnabled()) {
    return;
  }
  Store.dispatch(inferSegmentationInViewportAction(calculateGlobalPos(pos)));
}
