// @flow

import * as THREE from "three";
import update from "immutability-helper";

import type { Action } from "oxalis/model/actions/actions";
import { ArbitraryViewport, type Rect, type Viewport } from "oxalis/constants";
import type { OxalisState, PartialCameraData } from "oxalis/store";
import { getTDViewportSize } from "oxalis/model/accessors/view_mode_accessor";
import { zoomReducer } from "oxalis/model/reducers/flycam_reducer";

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
    case "SET_TD_CAMERA_WITHOUT_TIME_TRACKING":
    case "SET_TD_CAMERA": {
      return setTDCameraReducer(state, action.cameraData);
    }
    case "CENTER_TD_VIEW": {
      return centerTDViewReducer(state);
    }
    case "ZOOM_TD_VIEW": {
      return zoomTDView(
        state,
        action.value,
        action.targetPosition,
        action.curWidth,
        action.curHeight,
      );
    }
    case "MOVE_TD_VIEW_BY_VECTOR_WITHOUT_TIME_TRACKING":
    case "MOVE_TD_VIEW_BY_VECTOR": {
      return moveTDViewByVectorReducer(state, action.x, action.y);
    }
    case "SET_INPUT_CATCHER_RECT": {
      const newState = setInputCatcherRect(state, action.viewport, action.rect);
      return zoomReducer(newState, newState.flycam.zoomStep);
    }
    case "SET_INPUT_CATCHER_RECTS": {
      const { viewportRects } = action;
      let newState = state;
      for (const viewport of Object.keys(viewportRects)) {
        newState = setInputCatcherRect(newState, viewport, viewportRects[viewport]);
      }

      return zoomReducer(newState, newState.flycam.zoomStep);
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
            // $FlowIssue[invalid-computed-prop] See https://github.com/facebook/flow/issues/8299
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
  targetPosition: typeof THREE.Vector3,
  curWidth: number,
  curHeight: number,
): OxalisState {
  const camera = state.viewModeData.plane.tdCamera;

  const factor = Math.pow(0.9, value);
  const middleX = (camera.left + camera.right) / 2;
  const middleY = (camera.bottom + camera.top) / 2;
  const [width, height] = getTDViewportSize(state);

  const baseOffsetX = (factor * width) / 2;
  const baseOffsetY = (factor * height) / 2;
  const baseDiffX = baseOffsetX - width / 2;
  const baseDiffY = baseOffsetY - height / 2;

  let offsetX = 0;
  let offsetY = 0;
  if (targetPosition != null) {
    offsetX = ((targetPosition.x / curWidth) * 2 - 1) * -baseDiffX;
    offsetY = ((targetPosition.y / curHeight) * 2 - 1) * +baseDiffY;
  }

  return setTDCameraReducer(state, {
    left: middleX - baseOffsetX + offsetX,
    right: middleX + baseOffsetX + offsetX,
    top: middleY + baseOffsetY + offsetY,
    bottom: middleY - baseOffsetY + offsetY,
  });
}

export default ViewModeReducer;
