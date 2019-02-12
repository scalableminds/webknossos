// @flow

import * as THREE from "three";
import update from "immutability-helper";

import type { Action } from "oxalis/model/actions/actions";
import { ArbitraryViewport, type Rect, type Viewport } from "oxalis/constants";
import type { OxalisState, PartialCameraData } from "oxalis/store";
import { getTDViewportSize } from "oxalis/model/accessors/view_mode_accessor";

function ViewModeReducer(state: OxalisState, action: Action): OxalisState {
  switch (action.type) {
    case "SET_VIEWPORT": {
      return update(state, {
        viewModeData: {
          plane: {
            activeViewport: { $set: action.viewport },
          },
        },
      });
    }
    case "SET_TD_CAMERA": {
      return setTDCameraReducer(state, action.cameraData);
    }
    case "CENTER_TD_VIEW": {
      return centerTDViewReducer(state);
    }
    case "ZOOM_TD_VIEW": {
      return zoomTDView(state, action.value, action.targetPosition, action.curWidth);
    }
    case "MOVE_TD_VIEW_BY_VECTOR": {
      return moveTDViewByVectorReducer(state, action.x, action.y);
    }
    case "SET_INPUT_CATCHER_RECT": {
      return setInputCatcherRect(state, action.viewport, action.rect);
    }
    default:
      return state;
  }
}

function setInputCatcherRect(state: OxalisState, viewport: Viewport, rect: Rect) {
  if (viewport === ArbitraryViewport) {
    return update(state, {
      viewModeData: {
        arbitrary: {
          inputCatcherRect: {
            $set: rect,
          },
        },
      },
    });
  } else {
    return update(state, {
      viewModeData: {
        plane: {
          inputCatcherRects: {
            [viewport]: {
              $set: rect,
            },
          },
        },
      },
    });
  }
}

function moveTDViewByVectorReducer(state: OxalisState, x: number, y: number): OxalisState {
  const camera = state.viewModeData.plane.tdCamera;
  return update(state, {
    viewModeData: {
      plane: {
        tdCamera: {
          $merge: {
            left: camera.left + x,
            right: camera.right + x,
            top: camera.top + y,
            bottom: camera.bottom + y,
          },
        },
      },
    },
  });
}

function setTDCameraReducer(state: OxalisState, cameraData: PartialCameraData): OxalisState {
  return update(state, {
    viewModeData: {
      plane: {
        tdCamera: { $merge: cameraData },
      },
    },
  });
}

function centerTDViewReducer(state: OxalisState): OxalisState {
  const camera = state.viewModeData.plane.tdCamera;
  return moveTDViewByVectorReducer(
    state,
    -(camera.left + camera.right) / 2,
    -(camera.top + camera.bottom) / 2,
  );
}

function zoomTDView(
  state: OxalisState,
  value: number,
  targetPosition: THREE.Vector3,
  curWidth: number,
): OxalisState {
  const camera = state.viewModeData.plane.tdCamera;

  const factor = Math.pow(0.9, value);
  const middleX = (camera.left + camera.right) / 2;
  const middleY = (camera.bottom + camera.top) / 2;
  const size = getTDViewportSize();

  const baseOffset = (factor * size) / 2;
  const baseDiff = baseOffset - size / 2;

  let offsetX = 0;
  let offsetY = 0;
  if (targetPosition != null) {
    offsetX = ((targetPosition.x / curWidth) * 2 - 1) * -baseDiff;
    offsetY = ((targetPosition.y / curWidth) * 2 - 1) * +baseDiff;
  }

  return setTDCameraReducer(state, {
    left: middleX - baseOffset + offsetX,
    right: middleX + baseOffset + offsetX,
    top: middleY + baseOffset + offsetY,
    bottom: middleY - baseOffset + offsetY,
  });
}

export default ViewModeReducer;
