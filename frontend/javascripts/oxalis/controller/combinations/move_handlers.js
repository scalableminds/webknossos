// @flow
import Store from "oxalis/store";
import {
  OrthoViews,
  OrthoViewValuesWithoutTDView,
  type Point2,
  type Vector3,
  type OrthoView,
} from "oxalis/constants";
import Dimensions from "oxalis/model/dimensions";
import { getInputCatcherRect, calculateGlobalPos } from "oxalis/model/accessors/view_mode_accessor";
import { getResolutions, is2dDataset } from "oxalis/model/accessors/dataset_accessor";
import {
  movePlaneFlycamOrthoAction,
  moveFlycamOrthoAction,
  zoomByDeltaAction,
} from "oxalis/model/actions/flycam_actions";
import { setViewportAction, zoomTDViewAction } from "oxalis/model/actions/view_mode_actions";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { setMousePositionAction } from "oxalis/model/actions/volumetracing_actions";

export function setMousePosition(position: Point2): void {
  Store.dispatch(setMousePositionAction([position.x, position.y]));
}

export function handleOverViewport(planeId: OrthoView): void {
  Store.dispatch(setViewportAction(planeId));
}

export const movePlane = (v: Vector3, increaseSpeedWithZoom: boolean = true) => {
  const { activeViewport } = Store.getState().viewModeData.plane;
  Store.dispatch(movePlaneFlycamOrthoAction(v, activeViewport, increaseSpeedWithZoom));
};

export const handleMovePlane = (delta: Point2) => movePlane([-delta.x, -delta.y, 0]);

export const moveU = (deltaU: number): void => {
  movePlane([deltaU, 0, 0]);
};

export const moveV = (deltaV: number): void => {
  movePlane([0, deltaV, 0]);
};

export const moveW = (deltaW: number, oneSlide: boolean): void => {
  if (is2dDataset(Store.getState().dataset)) {
    return;
  }
  const { activeViewport } = Store.getState().viewModeData.plane;
  if (activeViewport === OrthoViews.TDView) {
    return;
  }

  if (oneSlide) {
    const logZoomStep = getRequestLogZoomStep(Store.getState());
    const wDim = Dimensions.getIndices(activeViewport)[2];
    const wStep = getResolutions(Store.getState().dataset)[logZoomStep][wDim];

    Store.dispatch(
      moveFlycamOrthoAction(
        Dimensions.transDim([0, 0, Math.sign(deltaW) * Math.max(1, wStep)], activeViewport),
        activeViewport,
      ),
    );
  } else {
    movePlane([0, 0, deltaW], false);
  }
};

export const zoom = (value: number, zoomToMouse: boolean) => {
  const { activeViewport } = Store.getState().viewModeData.plane;
  if (OrthoViewValuesWithoutTDView.includes(activeViewport)) {
    zoomPlanes(value, zoomToMouse);
  } else {
    zoomTDView(value);
  }
};

function getMousePosition() {
  const state = Store.getState();
  const { mousePosition } = state.temporaryConfiguration;
  if (mousePosition == null) {
    return null;
  }
  return calculateGlobalPos(state, { x: mousePosition[0], y: mousePosition[1] });
}

export function zoomPlanes(value: number, zoomToMouse: boolean): void {
  const oldMousePosition = zoomToMouse ? getMousePosition() : null;

  Store.dispatch(zoomByDeltaAction(value));

  if (zoomToMouse && oldMousePosition != null) {
    finishZoom(oldMousePosition);
  }
}

export function zoomTDView(value: number): void {
  const zoomToPosition = null;
  const { width, height } = getInputCatcherRect(Store.getState(), OrthoViews.TDView);
  Store.dispatch(zoomTDViewAction(value, zoomToPosition, width, height));
}

function finishZoom(oldMousePosition: Vector3): void {
  // Move the plane so that the mouse is at the same position as
  // before the zoom
  const { activeViewport } = Store.getState().viewModeData.plane;
  if (activeViewport !== OrthoViews.TDView) {
    const mousePos = getMousePosition();
    if (mousePos == null) {
      return;
    }
    const moveVector = [
      oldMousePosition[0] - mousePos[0],
      oldMousePosition[1] - mousePos[1],
      oldMousePosition[2] - mousePos[2],
    ];
    Store.dispatch(moveFlycamOrthoAction(moveVector, activeViewport));
  }
}
