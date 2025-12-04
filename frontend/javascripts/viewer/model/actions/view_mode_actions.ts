import type { OrthoView, Point2, Rect, Viewport, ViewportRects } from "viewer/constants";
import constants from "viewer/constants";
import { getTDViewportSize } from "viewer/model/accessors/view_mode_accessor";
import type { PartialCameraData } from "viewer/store";
import Store from "viewer/store";
type SetViewportAction = ReturnType<typeof setViewportAction>;
type SetTDCameraAction = ReturnType<typeof setTDCameraAction>;
type CenterTDViewAction = ReturnType<typeof centerTDViewAction>;
type ZoomTDViewAction = ReturnType<typeof zoomTDViewAction>;
type MoveTDViewByVectorAction = ReturnType<typeof moveTDViewByVectorAction>;
// These two actions are used instead of their functionally identical counterparts
// (without the `_WITHOUT_TIME_TRACKING` suffix)
// when dispatching these actions should not trigger the save queue diffing.
// Therefore, the save queue will not become dirty and no time is tracked by the backend.
// The actions are used by initialization code and by the `setTargetAndFixPosition`
// workaround in the td_controller.js.
type SetTDCameraWithoutTimeTrackingAction = ReturnType<typeof setTDCameraWithoutTimeTrackingAction>;
type MoveTDViewByVectorWithoutTimeTrackingAction = ReturnType<
  typeof moveTDViewByVectorWithoutTimeTrackingAction
>;
type SetInputCatcherRect = ReturnType<typeof setInputCatcherRect>;
type SetInputCatcherRects = ReturnType<typeof setInputCatcherRects>;

export const setViewportAction = (viewport: OrthoView) =>
  ({
    type: "SET_VIEWPORT",
    viewport,
  }) as const;

export const setTDCameraAction = (cameraData: PartialCameraData) =>
  ({
    type: "SET_TD_CAMERA",
    cameraData,
  }) as const;

// See the explanation further up for when to use this action instead of the setTDCameraAction
export const setTDCameraWithoutTimeTrackingAction = (cameraData: PartialCameraData) =>
  ({
    type: "SET_TD_CAMERA_WITHOUT_TIME_TRACKING",
    cameraData,
  }) as const;

export const centerTDViewAction = () =>
  ({
    type: "CENTER_TD_VIEW",
  }) as const;

export const zoomTDViewAction = (
  value: number,
  targetPosition: Point2 | null | undefined,
  curWidth: number,
  curHeight: number,
) =>
  ({
    type: "ZOOM_TD_VIEW",
    value,
    targetPosition,
    curWidth,
    curHeight,
  }) as const;

export const moveTDViewByVectorAction = (x: number, y: number) =>
  ({
    type: "MOVE_TD_VIEW_BY_VECTOR",
    x,
    y,
  }) as const;

// See the explanation further up for when to use this action instead of the moveTDViewByVectorAction
export const moveTDViewByVectorWithoutTimeTrackingAction = (x: number, y: number) =>
  ({
    type: "MOVE_TD_VIEW_BY_VECTOR_WITHOUT_TIME_TRACKING",
    x,
    y,
  }) as const;

export const moveTDViewXAction = (x: number): MoveTDViewByVectorAction => {
  const state = Store.getState();
  return moveTDViewByVectorAction((x * getTDViewportSize(state)[0]) / constants.VIEWPORT_WIDTH, 0);
};
export const moveTDViewYAction = (y: number): MoveTDViewByVectorAction => {
  const state = Store.getState();
  return moveTDViewByVectorAction(0, (-y * getTDViewportSize(state)[1]) / constants.VIEWPORT_WIDTH);
};
export const setInputCatcherRect = (viewport: Viewport, rect: Rect) =>
  ({
    type: "SET_INPUT_CATCHER_RECT",
    viewport,
    rect,
  }) as const;

export const setInputCatcherRects = (viewportRects: ViewportRects) =>
  ({
    type: "SET_INPUT_CATCHER_RECTS",
    viewportRects,
  }) as const;

export type ViewModeAction =
  | SetViewportAction
  | SetTDCameraAction
  | SetTDCameraWithoutTimeTrackingAction
  | CenterTDViewAction
  | ZoomTDViewAction
  | MoveTDViewByVectorAction
  | MoveTDViewByVectorWithoutTimeTrackingAction
  | SetInputCatcherRect
  | SetInputCatcherRects;

export const ViewModeSaveRelevantActions = [
  "SET_TD_CAMERA",
  "CENTER_TD_VIEW",
  "ZOOM_TD_VIEW",
  "MOVE_TD_VIEW_BY_VECTOR",
];
