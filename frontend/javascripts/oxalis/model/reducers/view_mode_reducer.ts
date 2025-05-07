import update from "immutability-helper";
import type { Point2, Rect, Viewport } from "oxalis/constants";
import { ArbitraryViewport } from "oxalis/constants";
import { getTDViewportSize } from "oxalis/model/accessors/view_mode_accessor";
import type { Action } from "oxalis/model/actions/actions";
import { zoomReducer } from "oxalis/model/reducers/flycam_reducer";
import type { PartialCameraData, WebknossosState } from "oxalis/store";

function ViewModeReducer(state: WebknossosState, action: Action): WebknossosState {
  switch (action.type) {
    case "SET_VIEWPORT": {
      return update(state, {
        viewModeData: {
          plane: {
            activeViewport: {
              $set: action.viewport,
            },
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
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string' is not assignable to par... Remove this comment to see the full error message
        newState = setInputCatcherRect(newState, viewport, viewportRects[viewport]);
      }

      return zoomReducer(newState, newState.flycam.zoomStep);
    }

    default:
      return state;
  }
}

function setInputCatcherRect(state: WebknossosState, viewport: Viewport, rect: Rect) {
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

function moveTDViewByVectorReducer(state: WebknossosState, x: number, y: number): WebknossosState {
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

function setTDCameraReducer(
  state: WebknossosState,
  cameraData: PartialCameraData,
): WebknossosState {
  return update(state, {
    viewModeData: {
      plane: {
        tdCamera: {
          $merge: cameraData,
        },
      },
    },
  });
}

function centerTDViewReducer(state: WebknossosState): WebknossosState {
  const camera = state.viewModeData.plane.tdCamera;
  return moveTDViewByVectorReducer(
    state,
    -(camera.left + camera.right) / 2,
    -(camera.top + camera.bottom) / 2,
  );
}

function zoomTDView(
  state: WebknossosState,
  value: number,
  targetPosition: Point2 | null | undefined,
  curWidth: number,
  curHeight: number,
): WebknossosState {
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
