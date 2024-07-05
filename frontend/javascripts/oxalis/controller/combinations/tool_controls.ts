import type { ModifierKeys } from "libs/input";
import * as THREE from "three";
import type { OrthoView, Point2, AnnotationTool, Vector3, Viewport } from "oxalis/constants";
import { OrthoViews, ContourModeEnum, AnnotationToolEnum } from "oxalis/constants";
import {
  enforceActiveVolumeTracing,
  getActiveSegmentationTracing,
  getContourTracingMode,
  getSegmentColorAsHSLA,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  handleAgglomerateSkeletonAtClick,
  handleClickSegment,
} from "oxalis/controller/combinations/segmentation_handlers";
import {
  computeQuickSelectForRectAction,
  confirmQuickSelectAction,
  hideBrushAction,
  maybePrefetchEmbeddingAction,
} from "oxalis/model/actions/volumetracing_actions";
import { isBrushTool } from "oxalis/model/accessors/tool_accessor";
import getSceneController from "oxalis/controller/scene_controller_provider";
import { finishedResizingUserBoundingBoxAction } from "oxalis/model/actions/annotation_actions";
import * as MoveHandlers from "oxalis/controller/combinations/move_handlers";
import PlaneView from "oxalis/view/plane_view";
import * as SkeletonHandlers from "oxalis/controller/combinations/skeleton_handlers";
import {
  createBoundingBoxAndGetEdges,
  handleMovingBoundingBox,
  SelectedEdge,
} from "oxalis/controller/combinations/bounding_box_handlers";
import {
  getClosestHoveredBoundingBox,
  handleResizingBoundingBox,
  highlightAndSetCursorOnHoveredBoundingBox,
} from "oxalis/controller/combinations/bounding_box_handlers";
import Store from "oxalis/store";
import * as Utils from "libs/utils";
import * as VolumeHandlers from "oxalis/controller/combinations/volume_handlers";
import { document } from "libs/window";
import { api } from "oxalis/singletons";
import {
  minCutAgglomerateWithPositionAction,
  proofreadAtPosition,
  proofreadMerge,
} from "oxalis/model/actions/proofread_actions";
import { calculateGlobalPos } from "oxalis/model/accessors/view_mode_accessor";
import { V3 } from "libs/mjs";
import {
  hideMeasurementTooltipAction,
  setQuickSelectStateAction,
  setLastMeasuredPositionAction,
  setIsMeasuringAction,
} from "oxalis/model/actions/ui_actions";
import ArbitraryView from "oxalis/view/arbitrary_view";

export type ActionDescriptor = {
  leftClick?: string;
  rightClick: string;
  leftDrag?: string;
  rightDrag?: string;
};

/*
  This module contains classes for the different tools, such as MoveTool, SkeletonTool, DrawTool etc.
  Each tool class defines getMouseControls which declares how mouse bindings are mapped (depending on
  modifiers) to actions. For the actions, code from oxalis/controller/combinations is called.

  If a tool does not define a specific mouse binding, the bindings of the MoveTool are used as a fallback.
  See `createToolDependentMouseHandler` in plane_controller.js

  In general, each tool has to check the pressed modifiers and delegate to another tool if necessary.
  For example, the drawing tool delegates to the pick-cell-tool if shift is pressed.
  In other modules, we usually use `adaptActiveToolToShortcuts` to know which tool should be active
  when pressing a modifier, but in this module we keep explicit control over which tool is really active
  and delegate manually.

  Note that `getActionDescriptors` must not delegate to other tools. Instead, the semantic is always
  so that the returned hint of class X is only rendered if `adaptActiveToolToShortcuts` returns X.
  Therefore, the returned actions of a tool class should only refer to the actions of that tool class.
*/
export class MoveTool {
  static getMouseControls(planeId: OrthoView, planeView: PlaneView): Record<string, any> {
    return {
      scroll: (delta: number, type: ModifierKeys | null | undefined) => {
        switch (type) {
          case null: {
            MoveHandlers.moveW(delta, true);
            break;
          }

          case "alt":
          case "ctrlOrMeta": {
            MoveHandlers.zoomPlanes(Utils.clamp(-1, delta, 1), true);
            break;
          }

          case "shift": {
            const { uiInformation, tracing } = Store.getState();
            const isBrushActive = isBrushTool(uiInformation.activeTool);

            if (isBrushActive) {
              // Different browsers send different deltas, this way the behavior is comparable
              if (delta > 0) {
                VolumeHandlers.changeBrushSizeIfBrushIsActiveBy(1);
              } else {
                VolumeHandlers.changeBrushSizeIfBrushIsActiveBy(-1);
              }
            } else if (tracing.skeleton) {
              // Different browsers send different deltas, this way the behavior is comparable
              api.tracing.setNodeRadius(delta > 0 ? 5 : -5);
            }

            break;
          }

          default: // ignore other cases
        }
      },
      over: () => {
        MoveHandlers.handleOverViewport(planeId);
      },
      leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        const { useLegacyBindings } = Store.getState().userConfiguration;

        if (event.shiftKey || !useLegacyBindings) {
          if (SkeletonHandlers.handleSelectNode(planeView, pos, plane, isTouch)) {
            return;
          }
        }

        handleClickSegment(pos);
      },
      middleClick: (pos: Point2, _plane: OrthoView, event: MouseEvent) => {
        if (event.shiftKey) {
          handleAgglomerateSkeletonAtClick(pos);
        }
      },
      pinch: (delta: number, center: Point2) => {
        MoveHandlers.setMousePosition(center);
        MoveHandlers.zoom(delta, true);
      },
      mouseMove: MoveHandlers.moveWhenAltIsPressed,
      out: () => {
        MoveHandlers.setMousePosition(null);
      },
      leftDownMove: (
        delta: Point2,
        _pos: Point2,
        _id: string | null | undefined,
        _event: MouseEvent,
      ) => {
        MoveHandlers.handleMovePlane(delta);
      },
      middleDownMove: MoveHandlers.handleMovePlane,
      rightClick: MoveTool.createRightClickHandler(planeView),
    };
  }

  static createRightClickHandler(planeView: PlaneView) {
    return (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) =>
      SkeletonHandlers.handleOpenContextMenu(planeView, pos, plane, isTouch, event);
  }

  static getActionDescriptors(
    _activeTool: AnnotationTool,
    useLegacyBindings: boolean,
    shiftKey: boolean,
    _ctrlOrMetaKey: boolean,
    altKey: boolean,
    _isTDViewportActive: boolean,
  ): ActionDescriptor {
    // In legacy mode, don't display a hint for
    // left click as it would be equal to left drag.
    // We also don't show a hint when the alt key was pressed,
    // as this mostly happens when the user presses alt in another tool
    // to move around while moving the mouse. In that case, clicking won't
    // select anything.
    const leftClickInfo =
      (useLegacyBindings && !shiftKey) || altKey
        ? {}
        : {
            leftClick: "Select Node",
          };
    return { ...leftClickInfo, leftDrag: "Move", rightClick: "Context Menu" };
  }

  static onToolDeselected() {}
}
export class SkeletonTool {
  static getMouseControls(planeView: PlaneView) {
    const legacyRightClick = (
      position: Point2,
      plane: OrthoView,
      event: MouseEvent,
      isTouch: boolean,
    ) => {
      const { activeViewport } = Store.getState().viewModeData.plane;

      if (activeViewport === OrthoViews.TDView) {
        return;
      }

      if (event.shiftKey) {
        SkeletonHandlers.handleOpenContextMenu(planeView, position, plane, isTouch, event);
      } else {
        SkeletonHandlers.handleCreateNode(position, event.ctrlKey || event.metaKey);
      }
    };

    let draggingNodeId: number | null | undefined = null;
    let didDragNode: boolean = false;
    return {
      leftMouseDown: (pos: Point2, plane: OrthoView, _event: MouseEvent, isTouch: boolean) => {
        const { useLegacyBindings } = Store.getState().userConfiguration;

        if (useLegacyBindings) {
          // There's no implicit node selection happening in the legacy mode
          return;
        }

        draggingNodeId = SkeletonHandlers.maybeGetNodeIdFromPosition(
          planeView,
          pos,
          plane,
          isTouch,
        );
      },
      leftMouseUp: () => {
        if (draggingNodeId != null && didDragNode) {
          SkeletonHandlers.finishNodeMovement(draggingNodeId);
        }
        draggingNodeId = null;
        didDragNode = false;
      },
      leftDownMove: (
        delta: Point2,
        _pos: Point2,
        _id: string | null | undefined,
        event: MouseEvent,
      ) => {
        const { tracing } = Store.getState();
        const { useLegacyBindings } = Store.getState().userConfiguration;

        if (
          tracing.skeleton != null &&
          (draggingNodeId != null || (useLegacyBindings && (event.ctrlKey || event.metaKey)))
        ) {
          didDragNode = true;
          SkeletonHandlers.moveNode(delta.x, delta.y, draggingNodeId, true);
        } else {
          MoveHandlers.handleMovePlane(delta);
        }
      },
      leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        this.onLeftClick(
          planeView,
          pos,
          event.shiftKey,
          event.altKey,
          event.ctrlKey || event.metaKey,
          plane,
          isTouch,
        );
      },
      rightClick: (position: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        const { useLegacyBindings } = Store.getState().userConfiguration;

        if (useLegacyBindings) {
          legacyRightClick(position, plane, event, isTouch);
          return;
        }

        SkeletonHandlers.handleOpenContextMenu(planeView, position, plane, isTouch, event);
      },
    };
  }

  static onLeftClick(
    planeView: PlaneView | ArbitraryView,
    position: Point2,
    shiftPressed: boolean,
    altPressed: boolean,
    ctrlPressed: boolean,
    plane: Viewport,
    isTouch: boolean,
    allowNodeCreation: boolean = true,
  ): void {
    const { useLegacyBindings } = Store.getState().userConfiguration;

    // The following functions are all covered by the context menu, too.
    // (At least, in the XY/XZ/YZ viewports).
    if (shiftPressed && altPressed) {
      SkeletonHandlers.handleMergeTrees(planeView, position, plane, isTouch);
      return;
    } else if (shiftPressed && ctrlPressed) {
      SkeletonHandlers.handleDeleteEdge(planeView, position, plane, isTouch);
      return;
    }

    let didSelectNode;
    if (shiftPressed || !useLegacyBindings) {
      didSelectNode = SkeletonHandlers.handleSelectNode(planeView, position, plane, isTouch);
    }

    if (allowNodeCreation && !didSelectNode && !useLegacyBindings && !shiftPressed) {
      // Will only have an effect, when not in 3D viewport
      SkeletonHandlers.handleCreateNode(position, ctrlPressed);
    }
  }

  static getActionDescriptors(
    _activeTool: AnnotationTool,
    useLegacyBindings: boolean,
    shiftKey: boolean,
    ctrlOrMetaKey: boolean,
    altKey: boolean,
    _isTDViewportActive: boolean,
  ): ActionDescriptor {
    // In legacy mode, don't display a hint for
    // left click as it would be equal to left drag
    let leftClickInfo = {};
    if (shiftKey && altKey) {
      leftClickInfo = {
        leftClick: "Create edge between nodes",
      };
    } else if (shiftKey && ctrlOrMetaKey) {
      leftClickInfo = {
        leftClick: "Delete edge between nodes",
      };
    } else if (shiftKey) {
      leftClickInfo = {
        leftClick: "Select node",
      };
    } else if (!useLegacyBindings && ctrlOrMetaKey && !shiftKey && !altKey) {
      leftClickInfo = {
        leftClick: "Place Node without Activating",
      };
    } else if (!useLegacyBindings && !ctrlOrMetaKey && !shiftKey && !altKey) {
      leftClickInfo = {
        leftClick: "Place/Select Node",
      };
    }

    return {
      ...leftClickInfo,
      leftDrag: "Move",
      rightClick: useLegacyBindings && !shiftKey ? "Place Node" : "Context Menu",
    };
  }

  static onToolDeselected() {}
}
export class DrawTool {
  static getPlaneMouseControls(_planeId: OrthoView, planeView: PlaneView): any {
    return {
      leftDownMove: (_delta: Point2, pos: Point2) => {
        VolumeHandlers.handleMoveForDrawOrErase(pos);
      },
      leftMouseDown: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        const ctrlOrMetaPressed = event.ctrlKey || event.metaKey;
        if (event.shiftKey && !ctrlOrMetaPressed) {
          // Should select cell. Do nothing, since case is covered by leftClick.
          return;
        }

        if (ctrlOrMetaPressed && event.shiftKey) {
          VolumeHandlers.handleEraseStart(pos, plane);
          return;
        }

        VolumeHandlers.handleDrawStart(pos, plane);
      },
      leftMouseUp: () => {
        VolumeHandlers.handleEndForDrawOrErase();
      },
      rightDownMove: (_delta: Point2, pos: Point2) => {
        const { useLegacyBindings } = Store.getState().userConfiguration;

        if (!useLegacyBindings) {
          return;
        }

        const state = Store.getState();
        const volumeTracing = enforceActiveVolumeTracing(state);
        const contourTracingMode = getContourTracingMode(volumeTracing);

        if (contourTracingMode === ContourModeEnum.DELETE) {
          VolumeHandlers.handleMoveForDrawOrErase(pos);
        }
      },
      rightMouseDown: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        const { useLegacyBindings } = Store.getState().userConfiguration;

        if (!useLegacyBindings) {
          return;
        }

        if (!event.shiftKey) {
          VolumeHandlers.handleEraseStart(pos, plane);
        }
      },
      rightMouseUp: () => {
        const { useLegacyBindings } = Store.getState().userConfiguration;

        if (!useLegacyBindings) {
          return;
        }

        VolumeHandlers.handleEndForDrawOrErase();
      },
      leftClick: (pos: Point2, _plane: OrthoView, event: MouseEvent) => {
        const ctrlOrMetaPressed = event.ctrlKey || event.metaKey;
        const shouldPickCell = event.shiftKey && !ctrlOrMetaPressed;
        const shouldErase = event.shiftKey && ctrlOrMetaPressed;

        if (shouldPickCell) {
          VolumeHandlers.handlePickCell(pos);
        } else if (shouldErase) {
          // Do nothing. This case is covered by leftMouseDown.
        }
      },
      rightClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        const { useLegacyBindings } = Store.getState().userConfiguration;

        if (useLegacyBindings) {
          // Don't do anything. rightMouse* will take care of brushing.
          return;
        }

        SkeletonHandlers.handleOpenContextMenu(planeView, pos, plane, isTouch, event);
      },
      out: () => {
        Store.dispatch(hideBrushAction());
      },
    };
  }

  static getActionDescriptors(
    activeTool: AnnotationTool,
    useLegacyBindings: boolean,
    _shiftKey: boolean,
    _ctrlOrMetaKey: boolean,
    _altKey: boolean,
    _isTDViewportActive: boolean,
  ): ActionDescriptor {
    let rightClick;

    if (!useLegacyBindings) {
      rightClick = "Context Menu";
    } else {
      rightClick = `Erase (${activeTool === AnnotationToolEnum.BRUSH ? "Brush" : "Trace"})`;
    }

    return {
      leftDrag: activeTool === AnnotationToolEnum.BRUSH ? "Brush" : "Trace",
      rightClick,
    };
  }

  static onToolDeselected() {}
}
export class EraseTool {
  static getPlaneMouseControls(_planeId: OrthoView, planeView: PlaneView): any {
    return {
      leftDownMove: (_delta: Point2, pos: Point2) => {
        VolumeHandlers.handleMoveForDrawOrErase(pos);
      },
      leftMouseDown: (pos: Point2, plane: OrthoView, _event: MouseEvent) => {
        VolumeHandlers.handleEraseStart(pos, plane);
      },
      leftMouseUp: () => {
        VolumeHandlers.handleEndForDrawOrErase();
      },
      rightClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        SkeletonHandlers.handleOpenContextMenu(planeView, pos, plane, isTouch, event);
      },
      out: () => {
        Store.dispatch(hideBrushAction());
      },
    };
  }

  static getActionDescriptors(
    activeTool: AnnotationTool,
    _useLegacyBindings: boolean,
    _shiftKey: boolean,
    _ctrlOrMetaKey: boolean,
    _altKey: boolean,
    _isTDViewportActive: boolean,
  ): ActionDescriptor {
    return {
      leftDrag: `Erase (${activeTool === AnnotationToolEnum.ERASE_BRUSH ? "Brush" : "Trace"})`,
      rightClick: "Context Menu",
    };
  }

  static onToolDeselected() {}
}
export class PickCellTool {
  static getPlaneMouseControls(_planeId: OrthoView): any {
    return {
      leftClick: (pos: Point2, _plane: OrthoView, _event: MouseEvent) => {
        VolumeHandlers.handlePickCell(pos);
      },
    };
  }

  static getActionDescriptors(
    _activeTool: AnnotationTool,
    _useLegacyBindings: boolean,
    _shiftKey: boolean,
    _ctrlOrMetaKey: boolean,
    _altKey: boolean,
    _isTDViewportActive: boolean,
  ): ActionDescriptor {
    return {
      leftClick: "Pick Segment",
      rightClick: "Context Menu",
    };
  }

  static onToolDeselected() {}
}
export class FillCellTool {
  static getPlaneMouseControls(_planeId: OrthoView): any {
    return {
      leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
        const shouldPickCell = event.shiftKey && !(event.ctrlKey || event.metaKey);

        if (shouldPickCell) {
          VolumeHandlers.handlePickCell(pos);
        } else {
          VolumeHandlers.handleFloodFill(pos, plane);
        }
      },
    };
  }

  static getActionDescriptors(
    _activeTool: AnnotationTool,
    _useLegacyBindings: boolean,
    _shiftKey: boolean,
    _ctrlOrMetaKey: boolean,
    _altKey: boolean,
    _isTDViewportActive: boolean,
  ): ActionDescriptor {
    return {
      leftClick: "Fill Segment",
      rightClick: "Context Menu",
    };
  }

  static onToolDeselected() {}
}
export class BoundingBoxTool {
  static getPlaneMouseControls(planeId: OrthoView, planeView: PlaneView): any {
    let primarySelectedEdge: SelectedEdge | null | undefined = null;
    let secondarySelectedEdge: SelectedEdge | null | undefined = null;
    return {
      leftDownMove: (
        delta: Point2,
        pos: Point2,
        _id: string | null | undefined,
        event: MouseEvent,
      ) => {
        if (primarySelectedEdge == null) {
          MoveHandlers.handleMovePlane(delta);
          return;
        }
        if (event.ctrlKey || event.metaKey) {
          handleMovingBoundingBox(delta, planeId, primarySelectedEdge);
        } else {
          handleResizingBoundingBox(pos, planeId, primarySelectedEdge, secondarySelectedEdge);
        }
      },
      leftMouseDown: (pos: Point2, _plane: OrthoView, _event: MouseEvent) => {
        let hoveredEdgesInfo = getClosestHoveredBoundingBox(pos, planeId);

        if (hoveredEdgesInfo) {
          [primarySelectedEdge, secondarySelectedEdge] = hoveredEdgesInfo;
        } else {
          hoveredEdgesInfo = createBoundingBoxAndGetEdges(pos, planeId);
          if (hoveredEdgesInfo) {
            [primarySelectedEdge, secondarySelectedEdge] = hoveredEdgesInfo;
          }
        }
        if (primarySelectedEdge) {
          getSceneController().highlightUserBoundingBox(primarySelectedEdge.boxId);
        }
      },
      leftMouseUp: () => {
        if (primarySelectedEdge) {
          Store.dispatch(finishedResizingUserBoundingBoxAction(primarySelectedEdge.boxId));
        }

        primarySelectedEdge = null;
        secondarySelectedEdge = null;
        getSceneController().highlightUserBoundingBox(null);
      },
      mouseMove: (delta: Point2, position: Point2, _id: any, event: MouseEvent) => {
        if (primarySelectedEdge == null && planeId !== OrthoViews.TDView) {
          MoveHandlers.moveWhenAltIsPressed(delta, position, _id, event);
          highlightAndSetCursorOnHoveredBoundingBox(position, planeId, event);
        }
      },
      rightClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        SkeletonHandlers.handleOpenContextMenu(planeView, pos, plane, isTouch, event);
      },
    };
  }

  static getActionDescriptors(
    _activeTool: AnnotationTool,
    _useLegacyBindings: boolean,
    _shiftKey: boolean,
    ctrlOrMetaKey: boolean,
    _altKey: boolean,
    _isTDViewportActive: boolean,
  ): ActionDescriptor {
    return {
      leftDrag: ctrlOrMetaKey ? "Move Bounding Boxes" : "Create/Resize Bounding Boxes",
      rightClick: "Context Menu",
    };
  }

  static onToolDeselected() {
    const { body } = document;

    if (body == null) {
      return;
    }
    getSceneController().highlightUserBoundingBox(null);
  }
}

export class QuickSelectTool {
  static getPlaneMouseControls(_planeId: OrthoView, planeView: PlaneView): any {
    let startPos: Vector3 | null = null;
    let currentPos: Vector3 | null = null;
    let isDragging = false;
    const SceneController = getSceneController();
    const { quickSelectGeometry } = SceneController;
    return {
      leftMouseDown: (pos: Point2, _plane: OrthoView, _event: MouseEvent) => {
        // Potentially confirm earlier quick select actions. That way, the user
        // can draw multiple rectangles even in preview mode. When starting a new
        // rectangle, the old one is confirmed. If no quick select rectangle exists,
        // this is a noop effectively.
        Store.dispatch(confirmQuickSelectAction());
        quickSelectGeometry.detachTextureMask();

        Store.dispatch(setQuickSelectStateAction("drawing"));

        const state = Store.getState();
        quickSelectGeometry.rotateToViewport();
        // Only show the center marker when using the heuristic
        // approach since the center will be used as a seed for the "floodfill".
        // For the ML-based approach, the center marker doesn't have any relevance.
        quickSelectGeometry.setCenterMarkerVisibility(
          Store.getState().userConfiguration.quickSelect.useHeuristic,
        );

        const volumeTracing = getActiveSegmentationTracing(state);
        if (!volumeTracing) {
          return;
        }

        const [h, s, l] = getSegmentColorAsHSLA(state, volumeTracing.activeCellId);
        const activeCellColor = new THREE.Color().setHSL(h, s, l);
        quickSelectGeometry.setColor(activeCellColor);
        startPos = V3.floor(calculateGlobalPos(state, pos));
        currentPos = startPos;
        isDragging = true;

        Store.dispatch(maybePrefetchEmbeddingAction(startPos));
      },
      leftMouseUp: () => {
        isDragging = false;
        // Identity equality is enough, since we want to catch the case
        // in which the user didn't move the mouse at all
        if (
          startPos === currentPos ||
          Store.getState().uiInformation.quickSelectState === "inactive"
        ) {
          // clear rectangle because user didn't drag
          return;
        }
        if (startPos != null && currentPos != null) {
          Store.dispatch(
            computeQuickSelectForRectAction(startPos, currentPos, quickSelectGeometry),
          );
        }
      },
      leftDownMove: (
        _delta: Point2,
        pos: Point2,
        _id: string | null | undefined,
        event: MouseEvent,
      ) => {
        if (
          !isDragging ||
          startPos == null ||
          Store.getState().uiInformation.quickSelectState === "inactive"
        ) {
          return;
        }
        const newCurrentPos = V3.floor(calculateGlobalPos(Store.getState(), pos));
        if (event.shiftKey) {
          // If shift is held, the rectangle is resized on topLeft and bottomRight
          // so that the center is constant.
          // We don't use the passed _delta variable, because that is given in pixel-space
          // instead of the physical space.
          if (currentPos) {
            const delta3D = V3.sub(newCurrentPos, currentPos);
            // Pseudo: startPos -= delta3D;
            V3.sub(startPos, delta3D, startPos);
          }
        }

        currentPos = newCurrentPos;

        quickSelectGeometry.setCoordinates(startPos, currentPos);
      },
      rightClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        SkeletonHandlers.handleOpenContextMenu(planeView, pos, plane, isTouch, event);
      },
    };
  }

  static getActionDescriptors(
    _activeTool: AnnotationTool,
    _useLegacyBindings: boolean,
    shiftKey: boolean,
    _ctrlOrMetaKey: boolean,
    _altKey: boolean,
    _isTDViewportActive: boolean,
  ): ActionDescriptor {
    return {
      leftDrag: shiftKey ? "Resize Rectangle symmetrically" : "Draw Rectangle around Segment",
      rightClick: "Context Menu",
    };
  }

  static onToolDeselected() {}
}

function getDoubleClickGuard() {
  const DOUBLE_CLICK_TIME_THRESHOLD = 600;
  const MAX_MOUSE_MOVEMENT_FOR_DOUBLE_CLICK = 6;
  let lastLeftClickTime = 0;
  let lastClickPosition: Point2 = { x: -100, y: -100 };
  const doubleClickGuard = (pos: Point2, onDoubleClick: () => void) => {
    const currentTime = Date.now();
    if (
      currentTime - lastLeftClickTime <= DOUBLE_CLICK_TIME_THRESHOLD &&
      Math.abs(pos.x - lastClickPosition.x) + Math.abs(pos.y - lastClickPosition.y) <
        MAX_MOUSE_MOVEMENT_FOR_DOUBLE_CLICK
    ) {
      // A double click should also terminate measuring.
      onDoubleClick();
      return true;
    }
    lastLeftClickTime = currentTime;
    lastClickPosition = pos;
    return false;
  };
  return doubleClickGuard;
}

export class LineMeasurementTool {
  static initialPlane: OrthoView = OrthoViews.PLANE_XY;
  static isMeasuring = false;
  static getPlaneMouseControls(): any {
    const doubleClickGuard = getDoubleClickGuard();
    const SceneController = getSceneController();
    const { lineMeasurementGeometry } = SceneController;
    const mouseMove = (
      _delta: Point2,
      pos: Point2,
      plane: OrthoView | null | undefined,
      evt: MouseEvent,
    ) => {
      // In case the tool was reset by the user, abort measuring.
      if (lineMeasurementGeometry.wasReset && this.isMeasuring) {
        this.isMeasuring = false;
        Store.dispatch(setIsMeasuringAction(false));
      }
      const isAltPressed = evt.altKey;
      if (isAltPressed || plane !== this.initialPlane || !this.isMeasuring) {
        MoveHandlers.moveWhenAltIsPressed(_delta, pos, plane, evt);
        return;
      }
      const state = Store.getState();
      const newPos = V3.floor(calculateGlobalPos(state, pos, this.initialPlane));
      lineMeasurementGeometry.updateLatestPointPosition(newPos);
      Store.dispatch(setLastMeasuredPositionAction(newPos));
    };
    const rightClick = (pos: Point2, plane: OrthoView, event: MouseEvent) => {
      // In case the tool was reset by the user, abort measuring.
      if (lineMeasurementGeometry.wasReset && this.isMeasuring) {
        this.isMeasuring = false;
        Store.dispatch(setIsMeasuringAction(false));
        return;
      }
      if (plane !== this.initialPlane) {
        return;
      }
      if (this.isMeasuring) {
        // Set the last point of the measurement and stop measuring.
        mouseMove({ x: 0, y: 0 }, pos, plane, event);
        this.isMeasuring = false;
        Store.dispatch(setIsMeasuringAction(false));
      } else {
        // If the tool already stopped measuring, reset the tool.
        lineMeasurementGeometry.resetAndHide();
        Store.dispatch(hideMeasurementTooltipAction());
      }
    };
    const leftClick = (pos: Point2, plane: OrthoView, event: MouseEvent) => {
      // In case the tool was reset by the user, abort measuring.
      if (lineMeasurementGeometry.wasReset && this.isMeasuring) {
        this.isMeasuring = false;
        Store.dispatch(setIsMeasuringAction(false));
        return;
      }
      if (
        doubleClickGuard(pos, () => {
          rightClick(pos, plane, event);
        }) ||
        (this.isMeasuring && plane !== this.initialPlane)
      ) {
        return;
      }
      // Set a new measurement point.
      const state = Store.getState();
      const position = V3.floor(calculateGlobalPos(state, pos, plane));
      if (!this.isMeasuring) {
        this.initialPlane = plane;
        lineMeasurementGeometry.setStartPoint(position, plane);
        this.isMeasuring = true;
        Store.dispatch(setIsMeasuringAction(true));
      } else {
        lineMeasurementGeometry.addPoint(position);
      }
      Store.dispatch(setLastMeasuredPositionAction(position));
    };
    return {
      mouseMove,
      rightClick,
      leftClick,
    };
  }

  static getActionDescriptors(
    _activeTool: AnnotationTool,
    _useLegacyBindings: boolean,
    _shiftKey: boolean,
    _ctrlOrMetaKey: boolean,
    _altKey: boolean,
    _isTDViewportActive: boolean,
  ): ActionDescriptor {
    return {
      leftClick: "Left Click to measure distance",
      rightClick: "Finish Measurement",
    };
  }

  static onToolDeselected() {
    const { lineMeasurementGeometry } = getSceneController();
    lineMeasurementGeometry.reset();
    lineMeasurementGeometry.hide();
    Store.dispatch(hideMeasurementTooltipAction());
    this.isMeasuring = false;
    this.initialPlane = OrthoViews.PLANE_XY;
  }
}

export class AreaMeasurementTool {
  static initialPlane: OrthoView = OrthoViews.PLANE_XY;
  static isMeasuring = false;
  static getPlaneMouseControls(): any {
    const SceneController = getSceneController();
    const { areaMeasurementGeometry } = SceneController;
    const doubleClickGuard = getDoubleClickGuard();
    const onRightClick = () => {
      areaMeasurementGeometry.reset();
      Store.dispatch(hideMeasurementTooltipAction());
    };
    return {
      leftDownMove: (
        _delta: Point2,
        pos: Point2,
        id: string | null | undefined,
        evt: MouseEvent,
      ) => {
        if (evt.altKey) {
          MoveHandlers.moveWhenAltIsPressed(_delta, pos, id, evt);
          return;
        }
        if (id == null) {
          return;
        }
        if (!this.isMeasuring) {
          this.initialPlane = id as OrthoView;
          this.isMeasuring = true;
          areaMeasurementGeometry.reset();
          areaMeasurementGeometry.show();
          areaMeasurementGeometry.setViewport(id as OrthoView);
        }
        if (id !== this.initialPlane) {
          return;
        }
        const state = Store.getState();
        const position = V3.floor(calculateGlobalPos(state, pos, this.initialPlane));
        areaMeasurementGeometry.addEdgePoint(position);
        Store.dispatch(setLastMeasuredPositionAction(position));
      },
      leftMouseUp: () => {
        if (!this.isMeasuring) {
          return;
        }
        // Stop drawing area and close the drawn area if still measuring.
        this.isMeasuring = false;
        areaMeasurementGeometry.connectToStartPoint();
      },
      rightClick: onRightClick,
      leftClick: (pos: Point2) => {
        doubleClickGuard(pos, onRightClick);
      },
    };
  }

  static getActionDescriptors(
    _activeTool: AnnotationTool,
    _useLegacyBindings: boolean,
    _shiftKey: boolean,
    _ctrlOrMetaKey: boolean,
    _altKey: boolean,
    _isTDViewportActive: boolean,
  ): ActionDescriptor {
    return {
      leftDrag: "Drag to measure area",
      rightClick: "Reset Measurement",
    };
  }

  static onToolDeselected() {
    const { areaMeasurementGeometry } = getSceneController();
    areaMeasurementGeometry.resetAndHide();
    Store.dispatch(hideMeasurementTooltipAction());
    this.isMeasuring = false;
    this.initialPlane = OrthoViews.PLANE_XY;
  }
}

export class ProofreadTool {
  static getPlaneMouseControls(_planeId: OrthoView, planeView: PlaneView): any {
    return {
      leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        this.onLeftClick(planeView, pos, plane, event, isTouch);
      },
    };
  }

  static onLeftClick(
    _planeView: PlaneView,
    pos: Point2,
    plane: OrthoView,
    event: MouseEvent,
    _isTouch: boolean,
  ) {
    if (plane === OrthoViews.TDView) {
      // The click position cannot be mapped to a 3D coordinate in the
      // 3D viewport.
      return;
    }

    const state = Store.getState();
    const globalPosition = calculateGlobalPos(state, pos);

    if (event.shiftKey) {
      Store.dispatch(proofreadMerge(globalPosition));
    } else if (event.ctrlKey || event.metaKey) {
      Store.dispatch(minCutAgglomerateWithPositionAction(globalPosition));
    } else {
      Store.dispatch(
        proofreadAtPosition(globalPosition, state.flycam.additionalCoordinates || undefined),
      );
      VolumeHandlers.handlePickCell(pos);
    }
  }

  static getActionDescriptors(
    _activeTool: AnnotationTool,
    _useLegacyBindings: boolean,
    shiftKey: boolean,
    ctrlOrMetaKey: boolean,
    _altKey: boolean,
    isTDViewportActive: boolean,
  ): ActionDescriptor {
    if (isTDViewportActive) {
      let maybeLeftClick = {};
      if (shiftKey) {
        maybeLeftClick = {
          leftClick: "Jump to point",
        };
      } else if (ctrlOrMetaKey) {
        maybeLeftClick = {
          leftClick: "Activate super-voxel",
        };
      }

      return {
        ...maybeLeftClick,
        leftDrag: "Move",
        rightClick: "Context Menu",
      };
    }
    let leftClick = "Select Segment to Proofread";
    if (shiftKey) {
      leftClick = "Merge with active Segment";
    } else if (ctrlOrMetaKey) {
      leftClick = "Split from active Segment";
    }

    return {
      leftClick,
      rightClick: "Context Menu",
    };
  }

  static onToolDeselected() {}
}
const toolToToolClass = {
  [AnnotationToolEnum.MOVE]: MoveTool,
  [AnnotationToolEnum.SKELETON]: SkeletonTool,
  [AnnotationToolEnum.BOUNDING_BOX]: BoundingBoxTool,
  [AnnotationToolEnum.QUICK_SELECT]: QuickSelectTool,
  [AnnotationToolEnum.PROOFREAD]: ProofreadTool,
  [AnnotationToolEnum.BRUSH]: DrawTool,
  [AnnotationToolEnum.TRACE]: DrawTool,
  [AnnotationToolEnum.ERASE_TRACE]: EraseTool,
  [AnnotationToolEnum.ERASE_BRUSH]: EraseTool,
  [AnnotationToolEnum.FILL_CELL]: FillCellTool,
  [AnnotationToolEnum.PICK_CELL]: PickCellTool,
  [AnnotationToolEnum.LINE_MEASUREMENT]: LineMeasurementTool,
  [AnnotationToolEnum.AREA_MEASUREMENT]: AreaMeasurementTool,
};
export function getToolClassForAnnotationTool(activeTool: AnnotationTool) {
  return toolToToolClass[activeTool];
}
