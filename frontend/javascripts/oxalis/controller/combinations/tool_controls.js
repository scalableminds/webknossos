import { connect } from "react-redux";
import BackboneEvents from "backbone-events-standalone";
import Clipboard from "clipboard-js";
import * as React from "react";
import _ from "lodash";

import { InputKeyboard, InputKeyboardNoLoop, InputMouse, type ModifierKeys } from "libs/input";
import { document } from "libs/window";
import { getBaseVoxel, getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import { getViewportScale, getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import {
  getPosition,
  getRequestLogZoomStep,
  getPlaneScalingFactor,
} from "oxalis/model/accessors/flycam_accessor";
import { getResolutions, is2dDataset } from "oxalis/model/accessors/dataset_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import {
  movePlaneFlycamOrthoAction,
  moveFlycamOrthoAction,
  zoomByDeltaAction,
  setPositionAction,
} from "oxalis/model/actions/flycam_actions";
import { setMousePositionAction } from "oxalis/model/actions/volumetracing_actions";
import { setViewportAction, zoomTDViewAction } from "oxalis/model/actions/view_mode_actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import Dimensions from "oxalis/model/dimensions";
import Model from "oxalis/model";
import PlaneView from "oxalis/view/plane_view";
import Store, { type OxalisState, type Tracing } from "oxalis/store";
import TDController from "oxalis/controller/td_controller";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import api from "oxalis/api/internal_api";
import constants, {
  type OrthoView,
  type OrthoViewMap,
  OrthoViewValuesWithoutTDView,
  OrthoViews,
  type Point2,
  type Vector3,
  AnnotationToolEnum,
  ContourModeEnum,
} from "oxalis/constants";
import getSceneController from "oxalis/controller/scene_controller_provider";
import * as skeletonController from "oxalis/controller/combinations/skeletontracing_plane_controller";
import * as volumeController from "oxalis/controller/combinations/volumetracing_plane_controller";
import { downloadScreenshot } from "oxalis/view/rendering_utils";
import { agglomerateSkeletonMiddleClick } from "oxalis/controller/combinations/segmentation_plane_controller";
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
import { getResolutionInfoOfSegmentationLayer } from "oxalis/model/accessors/dataset_accessor";
import {
  getContourTracingMode,
  enforceVolumeTracing,
} from "oxalis/model/accessors/volumetracing_accessor";

// TODO: Build proper UI for this
window.isAutomaticBrushEnabled = false;
const isAutomaticBrushEnabled = () =>
  window.isAutomaticBrushEnabled || Store.getState().temporaryConfiguration.isAutoBrushEnabled;

class Tool {}

export const movePlane = (v: Vector3, increaseSpeedWithZoom: boolean = true) => {
  const { activeViewport } = Store.getState().viewModeData.plane;
  Store.dispatch(movePlaneFlycamOrthoAction(v, activeViewport, increaseSpeedWithZoom));
};

const defaultDragHandler = (delta: Point2) => movePlane([-delta.x, -delta.y, 0]);

export class MoveTool extends Tool {
  static createRightClickHandler(planeView, showNodeContextMenuAt) {
    return (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) =>
      skeletonController.openContextMenu(
        planeView,
        pos,
        plane,
        isTouch,
        event,
        showNodeContextMenuAt,
      );
  }

  static getMouseControls(planeId: OrthoView, planeView, showNodeContextMenuAt, helpers): Object {
    const { zoom, scrollPlanes } = helpers;

    return {
      scroll: scrollPlanes,
      over: () => {
        Store.dispatch(setViewportAction(planeId));
      },
      pinch: delta => zoom(delta, true),
      mouseMove: (delta: Point2, position: Point2, id, event) => {
        if (event.altKey && !event.shiftKey) {
          movePlane([-delta.x, -delta.y, 0]);
        } else {
          Store.dispatch(setMousePositionAction([position.x, position.y]));
        }
      },
      leftDownMove: (delta: Point2, _pos: Point2, _id: ?string, _event: MouseEvent) => {
        movePlane([-delta.x, -delta.y, 0]);
      },
      middleDownMove: defaultDragHandler,
      rightClick: MoveTool.createRightClickHandler(planeView, showNodeContextMenuAt),
    };
  }
}

export class SkeletonTool extends Tool {
  static getMouseControls(
    planeView: PlaneView,
    showNodeContextMenuAt: (number, number, ?number, Vector3, OrthoView) => void,
  ) {
    return {
      leftDownMove: (delta: Point2, pos: Point2, _id: ?string, event: MouseEvent) => {
        const { tracing } = Store.getState();
        if (tracing.skeleton != null && event.ctrlKey) {
          skeletonController.moveNode(delta.x, delta.y);
        } else {
          movePlane([-delta.x, -delta.y, 0]);
        }
      },
      leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) =>
        skeletonController.onClick(
          planeView,
          pos,
          event.shiftKey,
          event.altKey,
          event.ctrlKey,
          plane,
          isTouch,
          event,
        ),
      rightClick: (position: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        const shiftPressed = event.shiftKey;
        const altPressed = event.altKey;
        const ctrlPressed = event.ctrlKey;

        const { activeViewport } = Store.getState().viewModeData.plane;
        if (activeViewport === OrthoViews.TDView) {
          return;
        }

        if (event.shiftKey) {
          skeletonController.handleOpenContextMenu(
            planeView,
            position,
            shiftPressed,
            altPressed,
            ctrlPressed,
            plane,
            isTouch,
            event,
            showNodeContextMenuAt,
          );
        } else {
          skeletonController.handleCreateNode(
            planeView,
            position,
            shiftPressed,
            altPressed,
            ctrlPressed,
          );
        }
      },
      middleClick: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        if (event.shiftKey) {
          agglomerateSkeletonMiddleClick(pos);
        }
      },
    };
  }
}

function pickCell(pos: Point2) {
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

export class VolumeTool extends Tool {
  static getPlaneMouseControls(_planeId: OrthoView): * {
    return {
      leftDownMove: (delta: Point2, pos: Point2) => {
        const { tracing } = Store.getState();
        const volumeTracing = enforceVolumeTracing(tracing);
        const tool = tracing.activeTool;
        const contourTracingMode = getContourTracingMode(volumeTracing);

        if (
          (tool === AnnotationToolEnum.TRACE || tool === AnnotationToolEnum.BRUSH) &&
          contourTracingMode === ContourModeEnum.DRAW
        ) {
          Store.dispatch(addToLayerAction(calculateGlobalPos(pos)));
        }
      },

      leftMouseDown: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        const tool = Store.getState().tracing.activeTool;

        if (
          !event.shiftKey &&
          (tool === AnnotationToolEnum.TRACE || tool === AnnotationToolEnum.BRUSH)
        ) {
          if (event.ctrlKey && isAutomaticBrushEnabled()) {
            return;
          }
          Store.dispatch(setContourTracingModeAction(ContourModeEnum.DRAW));
          Store.dispatch(startEditingAction(calculateGlobalPos(pos), plane));
        }
      },

      leftMouseUp: () => {
        const tool = Store.getState().tracing.activeTool;
        if (tool === AnnotationToolEnum.TRACE || tool === AnnotationToolEnum.BRUSH) {
          Store.dispatch(finishEditingAction());
          Store.dispatch(resetContourAction());
        }
      },

      rightDownMove: (delta: Point2, pos: Point2) => {
        const { tracing } = Store.getState();
        const volumeTracing = enforceVolumeTracing(tracing);
        const tool = tracing.activeTool;
        const contourTracingMode = getContourTracingMode(volumeTracing);

        if (
          (tool === AnnotationToolEnum.TRACE || tool === AnnotationToolEnum.BRUSH) &&
          contourTracingMode === ContourModeEnum.DELETE
        ) {
          Store.dispatch(addToLayerAction(calculateGlobalPos(pos)));
        }
      },

      rightMouseDown: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        const tool = Store.getState().tracing.activeTool;

        if (
          !event.shiftKey &&
          (tool === AnnotationToolEnum.TRACE || tool === AnnotationToolEnum.BRUSH)
        ) {
          Store.dispatch(setContourTracingModeAction(ContourModeEnum.DELETE));
          Store.dispatch(startEditingAction(calculateGlobalPos(pos), plane));
        }
      },

      rightMouseUp: () => {
        const tool = Store.getState().tracing.activeTool;

        if (tool === AnnotationToolEnum.TRACE || tool === AnnotationToolEnum.BRUSH) {
          Store.dispatch(finishEditingAction());
          Store.dispatch(resetContourAction());
        }
      },

      leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        const tool = Store.getState().tracing.activeTool;

        const shouldPickCell =
          tool === AnnotationToolEnum.PICK_CELL || (event.shiftKey && !event.ctrlKey);

        const shouldFillCell =
          tool === AnnotationToolEnum.FILL_CELL || (event.shiftKey && event.ctrlKey);

        if (shouldPickCell) {
          pickCell(pos);
        } else if (shouldFillCell) {
          Store.dispatch(floodFillAction(calculateGlobalPos(pos), plane));
        } else if (event.metaKey) {
          if (isAutomaticBrushEnabled()) {
            Store.dispatch(inferSegmentationInViewportAction(calculateGlobalPos(pos)));
          }
        }
      },

      rightClick: (_pos: Point2, _plane: OrthoView, _event: MouseEvent) => {
        // Don't do anything. rightMouse* will take care of brushing.
        // This handler has to be defined, as the rightClick handler of the move tool
        // would overtake otherwise.
      },

      out: () => {
        Store.dispatch(hideBrushAction());
      },
    };
  }
}
