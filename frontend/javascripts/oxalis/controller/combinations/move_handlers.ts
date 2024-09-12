import Store from "oxalis/store";
import type { Point2, Vector3, OrthoView } from "oxalis/constants";
import { OrthoViews, OrthoViewValuesWithoutTDView } from "oxalis/constants";
import Dimensions from "oxalis/model/dimensions";
import { getInputCatcherRect, calculateGlobalPos } from "oxalis/model/accessors/view_mode_accessor";
import { is2dDataset } from "oxalis/model/accessors/dataset_accessor";
import {
  movePlaneFlycamOrthoAction,
  moveFlycamOrthoAction,
  zoomByDeltaAction,
} from "oxalis/model/actions/flycam_actions";
import { setViewportAction, zoomTDViewAction } from "oxalis/model/actions/view_mode_actions";
import { getActiveResolutionInfo } from "oxalis/model/accessors/flycam_accessor";
import { setMousePositionAction } from "oxalis/model/actions/volumetracing_actions";
import _ from "lodash";

export function setMousePosition(position: Point2 | null | undefined): void {
  if (position != null) {
    Store.dispatch(setMousePositionAction([position.x, position.y]));
  } else {
    Store.dispatch(setMousePositionAction(null));
  }
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
    // The following logic might not always make sense when having layers
    // that are transformed each. Todo: Rethink / adapt the logic once
    // problems occur. Tracked in #6926.
    const { representativeResolution } = getActiveResolutionInfo(Store.getState());
    const wDim = Dimensions.getIndices(activeViewport)[2];
    const wStep = (representativeResolution || [1, 1, 1])[wDim];
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
export function moveWhenAltIsPressed(delta: Point2, position: Point2, _id: any, event: MouseEvent) {
  // Always set the correct mouse position. Otherwise, using alt + mouse move and
  // alt + scroll won't result in the correct zoomToMouse behavior.
  setMousePosition(position);

  if (event.altKey && !event.shiftKey && !(event.ctrlKey || event.metaKey)) {
    handleMovePlane(delta);
  }
}
export const zoom = (value: number, zoomToMouse: boolean) => {
  const { activeViewport } = Store.getState().viewModeData.plane;

  // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '"PLANE_XY" | "PLANE_YZ" | "PLANE... Remove this comment to see the full error message
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

  return calculateGlobalPos(state, {
    x: mousePosition[0],
    y: mousePosition[1],
  });
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
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number[]' is not assignable to p... Remove this comment to see the full error message
    Store.dispatch(moveFlycamOrthoAction(moveVector, activeViewport));
  }
}
