// @flow
import { movePlaneFlycamOrthoAction } from "oxalis/model/actions/flycam_actions";
import {
  setMousePositionAction,
  hideBrushAction,
} from "oxalis/model/actions/volumetracing_actions";
import { setViewportAction } from "oxalis/model/actions/view_mode_actions";
import PlaneView from "oxalis/view/plane_view";
import Store from "oxalis/store";
import {
  type OrthoView,
  OrthoViews,
  type Point2,
  type Vector3,
  AnnotationToolEnum,
  ContourModeEnum,
  type ShowContextMenuFunction,
} from "oxalis/constants";
import * as skeletonController from "oxalis/controller/combinations/skeletontracing_plane_controller";
import * as volumeController from "oxalis/controller/combinations/volumetracing_plane_controller";
import { handleAgglomerateSkeletonAtClick } from "oxalis/controller/combinations/segmentation_plane_controller";
import {
  getContourTracingMode,
  enforceVolumeTracing,
} from "oxalis/model/accessors/volumetracing_accessor";

export const movePlane = (v: Vector3, increaseSpeedWithZoom: boolean = true) => {
  const { activeViewport } = Store.getState().viewModeData.plane;
  Store.dispatch(movePlaneFlycamOrthoAction(v, activeViewport, increaseSpeedWithZoom));
};

const handleMovePlane = (delta: Point2) => movePlane([-delta.x, -delta.y, 0]);

export class MoveTool {
  static createRightClickHandler(
    planeView: PlaneView,
    showNodeContextMenuAt: ShowContextMenuFunction,
  ) {
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

  static getMouseControls(
    planeId: OrthoView,
    planeView: PlaneView,
    showNodeContextMenuAt: ShowContextMenuFunction,
    helpers: { zoom: Function, scrollPlanes: Function },
  ): Object {
    const { zoom, scrollPlanes } = helpers;

    return {
      scroll: scrollPlanes,
      over: () => {
        Store.dispatch(setViewportAction(planeId));
      },
      pinch: delta => zoom(delta, true),
      mouseMove: (delta: Point2, position: Point2, id, event) => {
        if (event.altKey && !event.shiftKey) {
          handleMovePlane(delta);
        } else {
          Store.dispatch(setMousePositionAction([position.x, position.y]));
        }
      },
      leftDownMove: (delta: Point2, _pos: Point2, _id: ?string, _event: MouseEvent) => {
        handleMovePlane(delta);
      },
      middleDownMove: handleMovePlane,
      rightClick: MoveTool.createRightClickHandler(planeView, showNodeContextMenuAt),
    };
  }
}

export class SkeletonTool {
  static onClick(
    planeView: PlaneView,
    position: Point2,
    shiftPressed: boolean,
    altPressed: boolean,
    ctrlPressed: boolean,
    plane: OrthoView,
    isTouch: boolean,
  ): void {
    if (!shiftPressed && !isTouch && !ctrlPressed) {
      // do nothing
      return;
    }

    if (altPressed) {
      skeletonController.handleMergeTrees(planeView, position, plane, isTouch);
    } else if (ctrlPressed) {
      skeletonController.handleDeleteEdge(planeView, position, plane, isTouch);
    } else {
      skeletonController.handleSelectNode(planeView, position, plane, isTouch);
    }
  }

  static getMouseControls(planeView: PlaneView, showNodeContextMenuAt: ShowContextMenuFunction) {
    return {
      leftDownMove: (delta: Point2, pos: Point2, _id: ?string, event: MouseEvent) => {
        const { tracing } = Store.getState();
        if (tracing.skeleton != null && event.ctrlKey) {
          skeletonController.moveNode(delta.x, delta.y);
        } else {
          handleMovePlane(delta);
        }
      },
      leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) =>
        this.onClick(planeView, pos, event.shiftKey, event.altKey, event.ctrlKey, plane, isTouch),
      rightClick: (position: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        const { activeViewport } = Store.getState().viewModeData.plane;
        if (activeViewport === OrthoViews.TDView) {
          return;
        }

        if (event.shiftKey) {
          skeletonController.handleOpenContextMenu(
            planeView,
            position,
            plane,
            isTouch,
            event,
            showNodeContextMenuAt,
          );
        } else {
          skeletonController.handleCreateNode(planeView, position, event.ctrlKey);
        }
      },
      middleClick: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        if (event.shiftKey) {
          handleAgglomerateSkeletonAtClick(pos);
        }
      },
    };
  }
}

export class DrawTool {
  static getPlaneMouseControls(_planeId: OrthoView): * {
    return {
      leftDownMove: (delta: Point2, pos: Point2) => {
        const { tracing } = Store.getState();
        const volumeTracing = enforceVolumeTracing(tracing);
        const contourTracingMode = getContourTracingMode(volumeTracing);

        if (contourTracingMode === ContourModeEnum.DRAW) {
          volumeController.handleDrawDeleteMove(pos);
        }
      },

      leftMouseDown: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        if (!event.shiftKey) {
          if (event.ctrlKey && volumeController.isAutomaticBrushEnabled()) {
            return;
          }
          volumeController.handleDrawStart(pos, plane);
        }
      },

      leftMouseUp: () => {
        volumeController.handleDrawEraseEnd();
      },

      rightDownMove: (delta: Point2, pos: Point2) => {
        const { tracing } = Store.getState();
        const volumeTracing = enforceVolumeTracing(tracing);
        const contourTracingMode = getContourTracingMode(volumeTracing);

        if (contourTracingMode === ContourModeEnum.DELETE) {
          volumeController.handleDrawDeleteMove(pos);
        }
      },

      rightMouseDown: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        if (!event.shiftKey) {
          volumeController.handleEraseStart(pos, plane);
        }
      },

      rightMouseUp: () => {
        volumeController.handleDrawEraseEnd();
      },

      leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        const shouldPickCell = event.shiftKey && !event.ctrlKey;
        const shouldFillCell = event.shiftKey && event.ctrlKey;

        if (shouldPickCell) {
          volumeController.handlePickCell(pos);
        } else if (shouldFillCell) {
          volumeController.handleFloodFill(pos, plane);
        } else if (event.metaKey) {
          volumeController.handleAutoBrush(pos);
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

export class PickCellTool {
  static getPlaneMouseControls(_planeId: OrthoView): * {
    return {
      leftClick: (pos: Point2, _plane: OrthoView, _event: MouseEvent) => {
        volumeController.handlePickCell(pos);
      },
    };
  }
}

export class FillCellTool {
  static getPlaneMouseControls(_planeId: OrthoView): * {
    return {
      leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        const tool = Store.getState().tracing.activeTool;

        const shouldPickCell =
          tool === AnnotationToolEnum.PICK_CELL || (event.shiftKey && !event.ctrlKey);

        const shouldFillCell =
          tool === AnnotationToolEnum.FILL_CELL || (event.shiftKey && event.ctrlKey);

        if (shouldPickCell) {
          volumeController.handlePickCell(pos);
        } else if (shouldFillCell) {
          volumeController.handleFloodFill(pos, plane);
        } else if (event.metaKey) {
          volumeController.handleAutoBrush(pos);
        }
      },
    };
  }
}
