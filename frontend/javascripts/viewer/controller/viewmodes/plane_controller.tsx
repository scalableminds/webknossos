import app from "app";
import { InputKeyboard, InputKeyboardNoLoop, InputMouse, type MouseBindingMap } from "libs/input";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import { document } from "libs/window";
import _ from "lodash";
import * as React from "react";
import { connect } from "react-redux";
import { userSettings } from "types/schemas/user_settings.schema";
import type { OrthoView, OrthoViewMap } from "viewer/constants";
import { OrthoViewValuesWithoutTDView, OrthoViews } from "viewer/constants";
import * as MoveHandlers from "viewer/controller/combinations/move_handlers";
import * as SkeletonHandlers from "viewer/controller/combinations/skeleton_handlers";
import {
  AreaMeasurementToolController,
  BoundingBoxToolController,
  DrawToolController,
  EraseToolController,
  FillCellToolController,
  LineMeasurementToolController,
  MoveToolController,
  ProofreadToolController,
  QuickSelectToolController,
  SkeletonToolController,
  VoxelPipetteToolController,
} from "viewer/controller/combinations/tool_controls";
import * as VolumeHandlers from "viewer/controller/combinations/volume_handlers";
import getSceneController, {
  getSceneControllerOrNull,
} from "viewer/controller/scene_controller_provider";
import TDController from "viewer/controller/td_controller";
import {
  getActiveMagIndexForLayer,
  getMoveOffset,
  getPosition,
} from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool, type AnnotationToolId } from "viewer/model/accessors/tool_accessor";
import { calculateGlobalPos } from "viewer/model/accessors/view_mode_accessor";
import {
  getActiveSegmentationTracing,
  getMaximumBrushSize,
} from "viewer/model/accessors/volumetracing_accessor";
import { addUserBoundingBoxAction } from "viewer/model/actions/annotation_actions";
import {
  pitchFlycamAction,
  rollFlycamAction,
  yawFlycamAction,
} from "viewer/model/actions/flycam_actions";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import {
  createBranchPointAction,
  createTreeAction,
  requestDeleteBranchPointAction,
  toggleAllTreesAction,
  toggleInactiveTreesAction,
} from "viewer/model/actions/skeletontracing_actions";
import { deleteNodeAsUserAction } from "viewer/model/actions/skeletontracing_actions_with_effects";
import {
  cycleToolAction,
  enterAction,
  escapeAction,
  setToolAction,
} from "viewer/model/actions/ui_actions";
import { setViewportAction } from "viewer/model/actions/view_mode_actions";
import {
  createCellAction,
  interpolateSegmentationLayerAction,
} from "viewer/model/actions/volumetracing_actions";
import dimensions, { type DimensionIndices } from "viewer/model/dimensions";
import Dimensions from "viewer/model/dimensions";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import { Model, api } from "viewer/singletons";
import type { BrushPresets, StoreAnnotation, WebknossosState } from "viewer/store";
import Store from "viewer/store";
import { getDefaultBrushSizes } from "viewer/view/action-bar/tools/brush_presets";
import { showToastWarningForLargestSegmentIdMissing } from "viewer/view/largest_segment_id_modal";
import PlaneView from "viewer/view/plane_view";
import { downloadScreenshot } from "viewer/view/rendering_utils";
import { highlightAndSetCursorOnHoveredBoundingBox } from "../combinations/bounding_box_handlers";
import {
  PlaneControllerLoopedNavigationKeyboardShortcuts,
  PlaneControllerLoopDelayedConfigKeyboardShortcuts,
  PlaneControllerNoLoopKeyboardShortcuts,
  type KeyboardShortcutHandlerMap,
  type KeyboardShortcutLoopedHandlerMap,
  PlaneControllerLoopDelayedNavigationKeyboardShortcuts,
  PlaneSkeletonNoLoopedKeyboardShortcuts,
  PlaneSkeletonLoopedKeyboardShortcuts,
} from "viewer/view/keyboard_shortcuts/keyboard_shortcut_constants";
import { loadKeyboardShortcuts } from "viewer/view/keyboard_shortcuts/keyboard_shortcut_persistence";
import {
  buildKeyBindingsFromConfigAndLoopedMapping,
  buildKeyBindingsFromConfigAndMapping,
} from "viewer/view/keyboard_shortcuts/keyboard_shortcut_utils";

function ensureNonConflictingHandlers(
  skeletonControls: Record<string, any>,
  volumeControls: Record<string, any>,
  proofreadControls?: Record<string, any>,
): void {
  const conflictingHandlers = _.intersection(
    Object.keys(skeletonControls),
    Object.keys(volumeControls),
    proofreadControls ? Object.keys(proofreadControls) : [],
  );

  if (conflictingHandlers.length > 0) {
    throw new Error(
      `There are unsolved conflicts between skeleton, volume and proofread controller: ${conflictingHandlers.join(
        ", ",
      )}`,
    );
  }
}

const FIXED_ROTATION_STEP = Math.PI / 2;

const cycleTools = () => {
  Store.dispatch(cycleToolAction());
};

const cycleToolsBackwards = () => {
  Store.dispatch(cycleToolAction(true));
};

const setTool = (tool: AnnotationTool) => {
  Store.dispatch(setToolAction(tool));
};

type StateProps = {
  annotation: StoreAnnotation;
  activeTool: AnnotationTool;
};
type Props = StateProps;

class SkeletonKeybindings {
  static getKeyboardControls(): KeyboardShortcutLoopedHandlerMap<PlaneSkeletonNoLoopedKeyboardShortcuts> {
    return {
      [PlaneSkeletonNoLoopedKeyboardShortcuts.TOGGLE_ALL_TREES_PLANE]: () =>
        Store.dispatch(toggleAllTreesAction()),
      [PlaneSkeletonNoLoopedKeyboardShortcuts.TOGGLE_INACTIVE_TREES_PLANE]: () =>
        Store.dispatch(toggleInactiveTreesAction()),
      // Delete active node
      [PlaneSkeletonNoLoopedKeyboardShortcuts.DELETE_ACTIVE_NODE_PLANE]: () =>
        Store.dispatch(deleteNodeAsUserAction(Store.getState())),
      [PlaneSkeletonNoLoopedKeyboardShortcuts.CREATE_TREE_PLANE]: () =>
        Store.dispatch(createTreeAction()),
      [PlaneSkeletonNoLoopedKeyboardShortcuts.MOVE_ALONG_DIRECTION]: () =>
        SkeletonHandlers.moveAlongDirection(),
      [PlaneSkeletonNoLoopedKeyboardShortcuts.MOVE_ALONG_DIRECTION_REVERSED]: () =>
        SkeletonHandlers.moveAlongDirection(true),
      // Branches
      [PlaneSkeletonNoLoopedKeyboardShortcuts.CREATE_BRANCH_POINT_PLANE]: () =>
        Store.dispatch(createBranchPointAction()),
      [PlaneSkeletonNoLoopedKeyboardShortcuts.DELETE_BRANCH_POINT_PLANE]: () =>
        Store.dispatch(requestDeleteBranchPointAction()),
      [PlaneSkeletonNoLoopedKeyboardShortcuts.RECENTER_ACTIVE_NODE_PLANE]: () => {
        api.tracing.centerNode();
        api.tracing.centerTDView();
      },
      // navigate nodes
      [PlaneSkeletonNoLoopedKeyboardShortcuts.NEXT_NODE_BACKWARD_PLANE]: () =>
        SkeletonHandlers.toPrecedingNode(),
      [PlaneSkeletonNoLoopedKeyboardShortcuts.NEXT_NODE_FORWARD_PLANE]: () =>
        SkeletonHandlers.toSubsequentNode(),
    };
  }

  static getLoopedKeyboardControls(): KeyboardShortcutLoopedHandlerMap<PlaneSkeletonLoopedKeyboardShortcuts> {
    return {
      [PlaneSkeletonLoopedKeyboardShortcuts.MOVE_NODE_LEFT]: () => SkeletonHandlers.moveNode(-1, 0),
      [PlaneSkeletonLoopedKeyboardShortcuts.MOVE_NODE_RIGHT]: () => SkeletonHandlers.moveNode(1, 0),
      [PlaneSkeletonLoopedKeyboardShortcuts.MOVE_NODE_UP]: () => SkeletonHandlers.moveNode(0, -1),
      [PlaneSkeletonLoopedKeyboardShortcuts.MOVE_NODE_DOWN]: () => SkeletonHandlers.moveNode(0, 1),
    };
  }

  static getExtendedKeyboardControls() {
    // TODOM: migrate to keystrokes.
    return { s: () => setTool(AnnotationTool.SKELETON) };
  }
}

class VolumeKeybindings {
  static getKeyboardControls() {
    return {
      c: () => {
        const volumeTracing = getActiveSegmentationTracing(Store.getState());

        if (volumeTracing == null || volumeTracing.tracingId == null) {
          return;
        }

        if (volumeTracing.largestSegmentId != null) {
          Store.dispatch(
            createCellAction(volumeTracing.activeCellId, volumeTracing.largestSegmentId),
          );
        } else {
          showToastWarningForLargestSegmentIdMissing(volumeTracing);
        }
      },
      v: () => {
        Store.dispatch(interpolateSegmentationLayerAction());
      },
    };
  }

  static getExtendedKeyboardControls() {
    return {
      b: () => setTool(AnnotationTool.BRUSH),
      e: () => setTool(AnnotationTool.ERASE_BRUSH),
      l: () => setTool(AnnotationTool.TRACE),
      r: () => setTool(AnnotationTool.ERASE_TRACE),
      f: () => setTool(AnnotationTool.FILL_CELL),
      p: () => setTool(AnnotationTool.VOXEL_PIPETTE),
      q: () => setTool(AnnotationTool.QUICK_SELECT),
      o: () => setTool(AnnotationTool.PROOFREAD),
    };
  }
}

class BoundingBoxKeybindings {
  static getKeyboardControls() {
    return {
      c: () => Store.dispatch(addUserBoundingBoxAction()),
      meta: BoundingBoxKeybindings.createKeyDownAndUpHandler(),
      ctrl: BoundingBoxKeybindings.createKeyDownAndUpHandler(),
    };
  }

  static handleUpdateCursor = (event: KeyboardEvent) => {
    const { viewModeData, temporaryConfiguration } = Store.getState();
    const { mousePosition } = temporaryConfiguration;
    if (mousePosition == null) return;
    highlightAndSetCursorOnHoveredBoundingBox(
      { x: mousePosition[0], y: mousePosition[1] },
      viewModeData.plane.activeViewport,
      event,
    );
  };

  static getExtendedKeyboardControls() {
    return { x: () => setTool(AnnotationTool.BOUNDING_BOX) };
  }

  static createKeyDownAndUpHandler() {
    return (event: KeyboardEvent) => BoundingBoxKeybindings.handleUpdateCursor(event);
  }
}

class ProofreadingKeybindings {
  static getKeyboardControls() {
    return {
      m: () => {
        const state = Store.getState();
        const isProofreadingActive = state.uiInformation.activeTool === AnnotationTool.PROOFREAD;
        if (isProofreadingActive) {
          const isMultiSplitActive = state.userConfiguration.isMultiSplitActive;
          Store.dispatch(updateUserSettingAction("isMultiSplitActive", !isMultiSplitActive));
        }
      },
    };
  }
}

function createDelayAwareMoveHandler(
  multiplier: number,
  useDynamicSpaceDirection: boolean = false,
) {
  // The multiplier can be used for inverting the direction as well as for
  // speeding up the movement as it's done for shift+f, for example.
  const fn = (timeFactor: number, first: boolean) =>
    MoveHandlers.moveW(
      getMoveOffset(Store.getState(), timeFactor) * multiplier,
      first,
      useDynamicSpaceDirection,
    );

  fn.customAdditionalDelayFn = () => {
    // Depending on the float fraction of the current position, we want to
    // delay subsequent movements longer or shorter.
    // For example, when being at z=10.0 and keeping `f` pressed, the first
    // move action will simply set z=11.0. Afterwards, a user-defined keyboard
    // delay is awaited after which the continuous movement can begin (z=11.1,
    // z=11.2, ... z=11.9, z=12.0...).
    // However, doing the same logic with a starting z=10.99 would mean, that
    // the initial movement bumps z to 11.99 and after the delay has passed,
    // the slice will immediately switch to 12 (which is too fast).
    // To compensate this effect, this code here takes the current fraction (and
    // direction) into account to adapt the initial keyboard delay.
    const state = Store.getState();
    let direction = Math.sign(multiplier);
    const { activeViewport } = state.viewModeData.plane;

    if (activeViewport === OrthoViews.TDView) {
      // Nothing should happen then, anyway.
      return 0;
    }

    const thirdDim = dimensions.thirdDimensionForPlane(activeViewport);
    const voxelPerSecond =
      state.userConfiguration.moveValue / state.dataset.dataSource.scale.factor[thirdDim];

    if (state.userConfiguration.dynamicSpaceDirection && useDynamicSpaceDirection) {
      // Change direction of the value connected to space, based on the last direction
      direction *= state.flycam.spaceDirectionOrtho[thirdDim];
    }

    const fraction = getPosition(state.flycam)[thirdDim] % 1;
    const passedFraction = direction === 1 ? fraction : 1 - fraction;
    // Note that a passed fraction of 0 (e.g., z=11.0 and the direction
    // goes towards 12), means that no additional delay is needed.
    // The 1000 factor converts to ms.
    return (1000 / voxelPerSecond) * passedFraction;
  };

  return fn;
}

class PlaneController extends React.PureComponent<Props> {
  // See comment in Controller class on general controller architecture.
  //
  // Plane Controller: Responsible for Plane Modes
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'planeView' has no initializer and is not... Remove this comment to see the full error message
  planeView: PlaneView;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'input' has no initializer and is not def... Remove this comment to see the full error message
  input: {
    mouseControllers: OrthoViewMap<InputMouse>;
    keyboard?: InputKeyboard;
    keyboardNoLoop?: InputKeyboardNoLoop;
    keyboardLoopDelayed?: InputKeyboard;
  };

  storePropertyUnsubscribers: Array<(...args: Array<any>) => any> = [];
  isStarted: boolean = false;
  unsubscribeKeyboardListener: any = () => {};

  componentDidMount() {
    this.input = {
      // @ts-expect-error ts-migrate(2739) FIXME: Type '{}' is missing the following properties from... Remove this comment to see the full error message
      mouseControllers: {},
    };
    this.isStarted = false;
    this.planeView = new PlaneView();
    this.forceUpdate();
    Store.dispatch(setViewportAction(OrthoViews.PLANE_XY));
    this.start();
  }

  componentWillUnmount() {
    this.stop();
  }

  initMouse(): void {
    // Workaround: We are only waiting for tdview since this introduces
    // the necessary delay to attach the events to the newest input
    // catchers (only necessary for HammerJS). We should refactor the
    // InputMouse handling so that this is not necessary anymore.
    // See: https://github.com/scalableminds/webknossos/issues/3475
    OrthoViewValuesWithoutTDView.forEach((id) => {
      const inputcatcherId = `inputcatcher_${OrthoViews[id]}`;
      Utils.waitForElementWithId(inputcatcherId).then((el) => {
        if (!document.body.contains(el)) {
          console.error("el is not attached anymore");
        }

        this.input.mouseControllers[id] = new InputMouse(
          inputcatcherId,
          this.getPlaneMouseControls(id),
          id,
          true,
        );
      });
    });
  }

  getPlaneMouseControls(planeId: OrthoView): MouseBindingMap {
    const moveControls = MoveToolController.getMouseControls(planeId, this.planeView);
    const skeletonControls = SkeletonToolController.getMouseControls(this.planeView);
    const drawControls = DrawToolController.getPlaneMouseControls(planeId, this.planeView);
    const eraseControls = EraseToolController.getPlaneMouseControls(planeId, this.planeView);
    const fillCellControls = FillCellToolController.getPlaneMouseControls(planeId);
    const voxelPipetteControls = VoxelPipetteToolController.getPlaneMouseControls(planeId);
    const boundingBoxControls = BoundingBoxToolController.getPlaneMouseControls(
      planeId,
      this.planeView,
    );
    const quickSelectControls = QuickSelectToolController.getPlaneMouseControls(
      planeId,
      this.planeView,
    );
    const proofreadControls = ProofreadToolController.getPlaneMouseControls(
      planeId,
      this.planeView,
    );
    const lineMeasurementControls = LineMeasurementToolController.getPlaneMouseControls();
    const areaMeasurementControls = AreaMeasurementToolController.getPlaneMouseControls();

    const allControlKeys = _.union(
      Object.keys(moveControls),
      Object.keys(skeletonControls),
      Object.keys(drawControls),
      Object.keys(eraseControls),
      Object.keys(fillCellControls),
      Object.keys(voxelPipetteControls),
      Object.keys(boundingBoxControls),
      Object.keys(quickSelectControls),
      Object.keys(proofreadControls),
      Object.keys(lineMeasurementControls),
      Object.keys(areaMeasurementControls),
    );

    const controls: MouseBindingMap = {};

    for (const controlKey of allControlKeys) {
      controls[controlKey] = this.createToolDependentMouseHandler({
        [AnnotationTool.MOVE.id]: moveControls[controlKey],
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        [AnnotationTool.SKELETON.id]: skeletonControls[controlKey],
        [AnnotationTool.BRUSH.id]: drawControls[controlKey],
        [AnnotationTool.TRACE.id]: drawControls[controlKey],
        [AnnotationTool.ERASE_BRUSH.id]: eraseControls[controlKey],
        [AnnotationTool.ERASE_TRACE.id]: eraseControls[controlKey],
        [AnnotationTool.VOXEL_PIPETTE.id]: voxelPipetteControls[controlKey],
        [AnnotationTool.FILL_CELL.id]: fillCellControls[controlKey],
        [AnnotationTool.BOUNDING_BOX.id]: boundingBoxControls[controlKey],
        [AnnotationTool.QUICK_SELECT.id]: quickSelectControls[controlKey],
        [AnnotationTool.PROOFREAD.id]: proofreadControls[controlKey],
        [AnnotationTool.LINE_MEASUREMENT.id]: lineMeasurementControls[controlKey],
        [AnnotationTool.AREA_MEASUREMENT.id]: areaMeasurementControls[controlKey],
      });
    }

    return controls;
  }

  getLoopedHandlerMap(): KeyboardShortcutLoopedHandlerMap<PlaneControllerLoopedNavigationKeyboardShortcuts> {
    const axisIndexToRotation = {
      0: pitchFlycamAction,
      1: yawFlycamAction,
      2: rollFlycamAction,
    };
    const rotateViewportAware = (
      timeFactor: number,
      dimensionIndex: DimensionIndices,
      oppositeDirection: boolean,
      fixedStepRotation: boolean = false,
    ) => {
      const state = Store.getState();
      const invertingFactor = oppositeDirection ? -1 : 1;
      const rotationAngle =
        (fixedStepRotation
          ? FIXED_ROTATION_STEP
          : state.userConfiguration.rotateValue * timeFactor) * invertingFactor;
      const { activeViewport } = state.viewModeData.plane;
      const viewportIndices = Dimensions.getIndices(activeViewport);
      const rotationAction = axisIndexToRotation[viewportIndices[dimensionIndex]];
      Store.dispatch(rotationAction(rotationAngle));
    };
    return {
      [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_LEFT]: (timeFactor: number) =>
        MoveHandlers.moveU(-getMoveOffset(Store.getState(), timeFactor)),
      [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_RIGHT]: (timeFactor: number) =>
        MoveHandlers.moveU(getMoveOffset(Store.getState(), timeFactor)),
      [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_UP]: (timeFactor: number) =>
        MoveHandlers.moveV(-getMoveOffset(Store.getState(), timeFactor)),
      [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_DOWN]: (timeFactor: number) =>
        MoveHandlers.moveV(getMoveOffset(Store.getState(), timeFactor)),
      [PlaneControllerLoopedNavigationKeyboardShortcuts.YAW_LEFT]: (timeFactor: number) =>
        rotateViewportAware(timeFactor, 1, false),
      [PlaneControllerLoopedNavigationKeyboardShortcuts.YAW_RIGHT]: (timeFactor: number) =>
        rotateViewportAware(timeFactor, 1, true),
      [PlaneControllerLoopedNavigationKeyboardShortcuts.PITCH_UP]: (timeFactor: number) =>
        rotateViewportAware(timeFactor, 0, false),
      [PlaneControllerLoopedNavigationKeyboardShortcuts.PITCH_DOWN]: (timeFactor: number) =>
        rotateViewportAware(timeFactor, 0, true),
      [PlaneControllerLoopedNavigationKeyboardShortcuts.ALT_ROLL_LEFT]: (timeFactor: number) =>
        rotateViewportAware(timeFactor, 2, false),
      [PlaneControllerLoopedNavigationKeyboardShortcuts.ALT_ROLL_RIGHT]: (timeFactor: number) =>
        rotateViewportAware(timeFactor, 2, true),
    } as KeyboardShortcutLoopedHandlerMap<PlaneControllerLoopedNavigationKeyboardShortcuts>;
  }

  getLoopDelayedHandlerMap(): KeyboardShortcutLoopedHandlerMap<PlaneControllerLoopDelayedConfigKeyboardShortcuts> {
    const loopedFromSkeleton = this.getLoopedKeyboardControls(); // re-use existing skeleton looped map if needed
    return {
      [PlaneControllerLoopDelayedConfigKeyboardShortcuts.DECREASE_BRUSH_SIZE]: () =>
        VolumeHandlers.changeBrushSizeIfBrushIsActiveBy(-1),
      [PlaneControllerLoopDelayedConfigKeyboardShortcuts.INCREASE_BRUSH_SIZE]: () =>
        VolumeHandlers.changeBrushSizeIfBrushIsActiveBy(1),
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_MULTIPLE_FORWARD]:
        createDelayAwareMoveHandler(5, true),
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_MULTIPLE_BACKWARD]:
        createDelayAwareMoveHandler(-5, true),
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_ONE_BACKWARD]:
        createDelayAwareMoveHandler(-1),
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_ONE_FORWARD]:
        createDelayAwareMoveHandler(1),
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_ONE_FORWARD_DIRECTION_AWARE]:
        createDelayAwareMoveHandler(1, true),
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_ONE_BACKWARD_DIRECTION_AWARE]:
        createDelayAwareMoveHandler(-1, true),
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.ZOOM_IN_PLANE]: () =>
        MoveHandlers.zoom(1, false),
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.ZOOM_OUT_PLANE]: () =>
        MoveHandlers.zoom(-1, false),
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.INCREASE_MOVE_VALUE_PLANE]: () =>
        this.changeMoveValue(25),
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.DECREASE_MOVE_VALUE_PLANE]: () =>
        this.changeMoveValue(-25),
      // merge any skeleton looped handlers if present (keys must be unique across domains)
      ...(loopedFromSkeleton as any),
    } as KeyboardShortcutLoopedHandlerMap<PlaneControllerLoopDelayedConfigKeyboardShortcuts>;
  }

  getNoLoopHandlerMap(): KeyboardShortcutHandlerMap<PlaneControllerNoLoopKeyboardShortcuts> {
    // compute dynamic handlers that depend on props/state like before
    const baseSkeleton =
      this.props.annotation.skeleton != null ? SkeletonKeybindings.getKeyboardControls() : {};
    const baseVolume =
      this.props.annotation.volumes.length > 0 ? VolumeKeybindings.getKeyboardControls() : {};
    const boundingBox = BoundingBoxKeybindings.getKeyboardControls();
    // derive the tool-dependent c/ctrl/meta handlers as before:
    const skeletonCHandler =
      this.props.annotation.skeleton != null ? SkeletonKeybindings.getKeyboardControls().c : null;
    const volumeCHandler =
      this.props.annotation.volumes.length > 0 ? VolumeKeybindings.getKeyboardControls().c : null;
    const boundingBoxCHandler = boundingBox.c;
    const skeletonCtrlHandler = boundingBox.ctrl;
    const skeletonMetaHandler = boundingBox.meta;

    return {
      [PlaneControllerNoLoopKeyboardShortcuts.COPY_SEGMENT_ID]: (event: KeyboardEvent | any) => {
        const segmentationLayer = Model.getVisibleSegmentationLayer();
        const { additionalCoordinates } = Store.getState().flycam;

        if (!segmentationLayer) {
          return;
        }

        const { mousePosition } = Store.getState().temporaryConfiguration;

        if (mousePosition) {
          const [x, y] = mousePosition;
          const globalMousePositionRounded = calculateGlobalPos(Store.getState(), {
            x,
            y,
          }).rounded;
          const { cube } = segmentationLayer;
          const mapping = event && event.altKey ? cube.getMapping() : null;
          const hoveredId = cube.getDataValue(
            globalMousePositionRounded,
            additionalCoordinates,
            mapping,
            getActiveMagIndexForLayer(Store.getState(), segmentationLayer.name),
          );
          navigator.clipboard
            .writeText(String(hoveredId))
            .then(() => Toast.success(`Segment id ${hoveredId} copied to clipboard.`));
        } else {
          Toast.warning("No segment under cursor.");
        }
      },
      [PlaneControllerNoLoopKeyboardShortcuts.DOWNLOAD_SCREENSHOT]: () => downloadScreenshot(),
      [PlaneControllerNoLoopKeyboardShortcuts.CYCLE_TOOLS]: () => cycleTools(),
      [PlaneControllerNoLoopKeyboardShortcuts.CYCLE_TOOLS_BACKWARDS]: () => cycleToolsBackwards(),
      [PlaneControllerNoLoopKeyboardShortcuts.SET_TOOL_MOVE]: () => setTool(AnnotationTool.MOVE),
      [PlaneControllerNoLoopKeyboardShortcuts.BRUSH_PRESET_SMALL]: () =>
        this.handleUpdateBrushSize("small"),
      [PlaneControllerNoLoopKeyboardShortcuts.BRUSH_PRESET_MEDIUM]: () =>
        this.handleUpdateBrushSize("medium"),
      [PlaneControllerNoLoopKeyboardShortcuts.BRUSH_PRESET_LARGE]: () =>
        this.handleUpdateBrushSize("large"),
      [PlaneControllerNoLoopKeyboardShortcuts.BOUNDING_BOX_EXTENDED]: () =>
        BoundingBoxKeybindings.getExtendedKeyboardControls().x(),
      [PlaneControllerNoLoopKeyboardShortcuts.TOGGLE_ALL_TREES_PLANE]: () =>
        Store.dispatch(toggleAllTreesAction()),
      [PlaneControllerNoLoopKeyboardShortcuts.TOGGLE_INACTIVE_TREES_PLANE]: () =>
        Store.dispatch(toggleInactiveTreesAction()),
      [PlaneControllerNoLoopKeyboardShortcuts.DELETE_ACTIVE_NODE_PLANE]: () =>
        Store.dispatch(deleteNodeAsUserAction(Store.getState())),
      [PlaneControllerNoLoopKeyboardShortcuts.CREATE_TREE_PLANE]: () =>
        Store.dispatch(createTreeAction()),
      [PlaneControllerNoLoopKeyboardShortcuts.MOVE_ALONG_DIRECTION]: () =>
        SkeletonHandlers.moveAlongDirection(),
      [PlaneControllerNoLoopKeyboardShortcuts.MOVE_ALONG_DIRECTION_REVERSED]: () =>
        SkeletonHandlers.moveAlongDirection(true),
      [PlaneControllerNoLoopKeyboardShortcuts.CREATE_BRANCH_POINT_PLANE]: () =>
        Store.dispatch(createBranchPointAction()),
      [PlaneControllerNoLoopKeyboardShortcuts.DELETE_BRANCH_POINT_PLANE]: () =>
        Store.dispatch(requestDeleteBranchPointAction()),
      [PlaneControllerNoLoopKeyboardShortcuts.RECENTER_ACTIVE_NODE_PLANE]: () => {
        api.tracing.centerNode();
        api.tracing.centerTDView();
      },
      [PlaneControllerNoLoopKeyboardShortcuts.NAV_PREV_NODE]: () =>
        SkeletonHandlers.toPrecedingNode(),
      [PlaneControllerNoLoopKeyboardShortcuts.NAV_NEXT_NODE]: () =>
        SkeletonHandlers.toSubsequentNode(),
      // Tool-dependent handlers (recreate the same composite handlers as before)
      [PlaneControllerNoLoopKeyboardShortcuts.TOOL_DEPENDENT_C]:
        this.createToolDependentKeyboardHandler(
          skeletonCHandler,
          volumeCHandler,
          boundingBoxCHandler,
        ),
      [PlaneControllerNoLoopKeyboardShortcuts.TOOL_DEPENDENT_CTRL]:
        this.createToolDependentKeyboardHandler(null, null, skeletonCtrlHandler),
      [PlaneControllerNoLoopKeyboardShortcuts.TOOL_DEPENDENT_META]:
        this.createToolDependentKeyboardHandler(null, null, skeletonMetaHandler),
    } as KeyboardShortcutHandlerMap<PlaneControllerNoLoopKeyboardShortcuts>;
  }

  reloadKeyboardShortcuts() {
    // destroy existing keyboards
    this.input.keyboard?.destroy();
    this.input.keyboardLoopDelayed?.destroy();
    this.input.keyboardNoLoop?.destroy();

    const keybindingConfig = loadKeyboardShortcuts();

    // looped keyboard
    const loopedBindings = buildKeyBindingsFromConfigAndLoopedMapping(
      keybindingConfig,
      this.getLoopedHandlerMap(),
    );
    this.input.keyboard = new InputKeyboard(loopedBindings);

    // delayed looped keyboard
    const delayedBindings = buildKeyBindingsFromConfigAndLoopedMapping(
      keybindingConfig,
      this.getLoopDelayedHandlerMap(),
    );
    const withAdditionalActions = {
      ...delayedBindings,
      // Enter & Escape need to be separate due to being constant and not configurable.
      enter: () => Store.dispatch(enterAction()),
      esc: () => Store.dispatch(escapeAction()),
    };
    this.input.keyboardLoopDelayed = new InputKeyboard(withAdditionalActions, {
      delay: Store.getState().userConfiguration.keyboardDelay,
    });

    // no-loop keyboard
    const noLoopBindings = buildKeyBindingsFromConfigAndMapping(
      keybindingConfig,
      this.getNoLoopHandlerMap(),
    );

    // InputKeyboardNoLoop uses: (bindings, options, extendedHandlers, keyUpHandlers)
    // We previously constructed some of those dynamically; for compatibility we build "extended" from getNotLoopedKeyboardControls
    const { extendedControls: extendedNotLoopedKeyboardControls, keyUpControls } =
      this.getNotLoopedKeyboardControls();
    this.input.keyboardNoLoop = new InputKeyboardNoLoop(
      noLoopBindings,
      {},
      extendedNotLoopedKeyboardControls,
      keyUpControls,
    );
  }

  initKeyboard(): void {
    // avoid scrolling while pressing space
    document.addEventListener("keydown", (event: KeyboardEvent) => {
      if (
        (event.which === 32 || event.which === 18 || (event.which >= 37 && event.which <= 40)) &&
        Utils.isNoElementFocussed()
      ) {
        event.preventDefault();
      }
    });

    // create keyboards from persisted config
    this.reloadKeyboardShortcuts();

    // register refresh listener
    this.unsubscribeKeyboardListener = app.vent.on("refreshKeyboardShortcuts", () =>
      this.reloadKeyboardShortcuts(),
    );

    // keep existing listener for keyboardDelay change
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (state) => state.userConfiguration.keyboardDelay,
        (keyboardDelay) => {
          const { keyboardLoopDelayed } = this.input;

          if (keyboardLoopDelayed != null) {
            keyboardLoopDelayed.delay = keyboardDelay;
          }
        },
      ),
    );
  }

  getBrushPresetsOrSetDefault(): BrushPresets {
    const brushPresetsFromStore = Store.getState().userConfiguration.presetBrushSizes;
    if (brushPresetsFromStore != null) {
      return brushPresetsFromStore;
    } else {
      const maximumBrushSize = getMaximumBrushSize(Store.getState());
      const defaultBrushSizes = getDefaultBrushSizes(
        maximumBrushSize,
        userSettings.brushSize.minimum,
      );
      Store.dispatch(updateUserSettingAction("presetBrushSizes", defaultBrushSizes));
      return defaultBrushSizes;
    }
  }

  handleUpdateBrushSize(size: "small" | "medium" | "large") {
    const brushPresets = this.getBrushPresetsOrSetDefault();
    switch (size) {
      case "small":
        Store.dispatch(updateUserSettingAction("brushSize", brushPresets.small));
        break;
      case "medium":
        Store.dispatch(updateUserSettingAction("brushSize", brushPresets.medium));
        break;
      case "large":
        Store.dispatch(updateUserSettingAction("brushSize", brushPresets.large));
        break;
    }
    return;
  }

  getNotLoopedKeyboardControls(): Record<string, any> {
    const baseControls = {
      "ctrl + i": (event: React.KeyboardEvent) => {
        const segmentationLayer = Model.getVisibleSegmentationLayer();
        const { additionalCoordinates } = Store.getState().flycam;

        if (!segmentationLayer) {
          return;
        }

        const { mousePosition } = Store.getState().temporaryConfiguration;

        if (mousePosition) {
          const [x, y] = mousePosition;
          const globalMousePositionRounded = calculateGlobalPos(Store.getState(), {
            x,
            y,
          }).rounded;
          const { cube } = segmentationLayer;
          const mapping = event.altKey ? cube.getMapping() : null;
          const hoveredId = cube.getDataValue(
            globalMousePositionRounded,
            additionalCoordinates,
            mapping,
            getActiveMagIndexForLayer(Store.getState(), segmentationLayer.name),
          );
          navigator.clipboard
            .writeText(String(hoveredId))
            .then(() => Toast.success(`Segment id ${hoveredId} copied to clipboard.`));
        } else {
          Toast.warning("No segment under cursor.");
        }
      },
      q: downloadScreenshot,
      w: cycleTools,
      "shift + w": cycleToolsBackwards,
    };

    let extendedControls = {
      m: () => setTool(AnnotationTool.MOVE),
      1: () => this.handleUpdateBrushSize("small"),
      2: () => this.handleUpdateBrushSize("medium"),
      3: () => this.handleUpdateBrushSize("large"),
      ...BoundingBoxKeybindings.getExtendedKeyboardControls(),
    };

    // TODO: Find a nicer way to express this, while satisfying flow
    const emptyDefaultHandler = {
      c: null,
    };
    const { c: skeletonCHandler, ...skeletonControls } =
      this.props.annotation.skeleton != null
        ? SkeletonKeybindings.getKeyboardControls()
        : emptyDefaultHandler;
    const { c: volumeCHandler, ...volumeControls } =
      this.props.annotation.volumes.length > 0
        ? VolumeKeybindings.getKeyboardControls()
        : emptyDefaultHandler;
    const {
      c: boundingBoxCHandler,
      meta: boundingBoxMetaHandler,
      ctrl: boundingBoxCtrlHandler,
    } = BoundingBoxKeybindings.getKeyboardControls();
    const proofreadingControls =
      this.props.annotation.volumes.length > 0
        ? ProofreadingKeybindings.getKeyboardControls()
        : emptyDefaultHandler;
    ensureNonConflictingHandlers(skeletonControls, volumeControls, proofreadingControls);
    const extendedSkeletonControls =
      this.props.annotation.skeleton != null
        ? SkeletonKeybindings.getExtendedKeyboardControls()
        : {};
    const extendedVolumeControls =
      this.props.annotation.volumes.length > 0 != null
        ? VolumeKeybindings.getExtendedKeyboardControls()
        : {};
    ensureNonConflictingHandlers(extendedSkeletonControls, extendedVolumeControls);
    const extendedAnnotationControls = { ...extendedSkeletonControls, ...extendedVolumeControls };
    ensureNonConflictingHandlers(extendedAnnotationControls, extendedControls);
    extendedControls = { ...extendedControls, ...extendedAnnotationControls };

    return {
      baseControls: {
        ...baseControls,
        ...skeletonControls,
        ...volumeControls,
        ...proofreadingControls,
        c: this.createToolDependentKeyboardHandler(
          skeletonCHandler,
          volumeCHandler,
          boundingBoxCHandler,
        ),
        ctrl: this.createToolDependentKeyboardHandler(null, null, boundingBoxCtrlHandler),
        meta: this.createToolDependentKeyboardHandler(null, null, boundingBoxMetaHandler),
      },
      keyUpControls: {
        ctrl: this.createToolDependentKeyboardHandler(null, null, boundingBoxCtrlHandler),
        meta: this.createToolDependentKeyboardHandler(null, null, boundingBoxMetaHandler),
      },
      extendedControls,
    };
  }

  getLoopedKeyboardControls() {
    // Note that this code needs to be adapted in case the VolumeHandlers also starts to expose
    // looped keyboard controls. For the hybrid case, these two controls would need t be combined then.
    return this.props.annotation.skeleton != null
      ? SkeletonKeybindings.getLoopedKeyboardControls()
      : {};
  }

  init(): void {
    const { clippingDistance } = Store.getState().userConfiguration;
    getSceneController().setClippingDistance(clippingDistance);
  }

  start(): void {
    getSceneController().startPlaneMode();
    this.planeView.start();
    this.initKeyboard();
    this.initMouse();
    this.init();
    this.isStarted = true;
  }

  stop(): void {
    if (this.isStarted) {
      this.destroyInput();
    }

    // unregister keyboard refresh listener
    try {
      this.unsubscribeKeyboardListener();
    } catch (e) {
      // ignore if already removed
    }

    // SceneController will already be null, if the user left the dataset view
    // because componentWillUnmount will trigger earlier for outer components and
    // later for inner components. The outer component TracingLayoutView is responsible
    // for the destroy call which already happened when the stop method here is called.
    getSceneControllerOrNull()?.stopPlaneMode();

    this.planeView.stop();
    this.isStarted = false;
  }

  changeMoveValue(delta: number): void {
    const moveValue = Store.getState().userConfiguration.moveValue + delta;
    Store.dispatch(updateUserSettingAction("moveValue", moveValue));
  }

  unsubscribeStoreListeners() {
    this.storePropertyUnsubscribers.forEach((unsubscribe) => unsubscribe());
    this.storePropertyUnsubscribers = [];
  }

  destroyInput() {
    for (const mouse of _.values(this.input.mouseControllers)) {
      mouse.destroy();
    }

    // @ts-expect-error ts-migrate(2739) FIXME: Type '{}' is missing the following properties from... Remove this comment to see the full error message
    this.input.mouseControllers = {};

    this.input.keyboard?.destroy();
    this.input.keyboardNoLoop?.destroy();
    this.input.keyboardLoopDelayed?.destroy();

    this.unsubscribeStoreListeners();
  }

  createToolDependentKeyboardHandler(
    skeletonHandler: ((...args: Array<any>) => any) | null | undefined,
    volumeHandler: ((...args: Array<any>) => any) | null | undefined,
    boundingBoxHandler: ((...args: Array<any>) => any) | null | undefined,
    viewHandler?: ((...args: Array<any>) => any) | null | undefined,
  ): (...args: Array<any>) => any {
    return (...args) => {
      const tool = this.props.activeTool;

      switch (tool) {
        case AnnotationTool.MOVE: {
          if (viewHandler != null) {
            viewHandler(...args);
          } else if (skeletonHandler != null) {
            skeletonHandler(...args);
          }

          return;
        }

        case AnnotationTool.SKELETON: {
          if (skeletonHandler != null) {
            skeletonHandler(...args);
          } else if (viewHandler != null) {
            viewHandler(...args);
          }

          return;
        }

        case AnnotationTool.BOUNDING_BOX: {
          if (boundingBoxHandler != null) {
            boundingBoxHandler(...args);
          } else if (viewHandler != null) {
            viewHandler(...args);
          }

          return;
        }

        default: {
          if (volumeHandler != null) {
            volumeHandler(...args);
          } else if (viewHandler != null) {
            viewHandler(...args);
          }
        }
      }
    };
  }

  createToolDependentMouseHandler(
    toolToHandlerMap: Record<AnnotationToolId, (...args: Array<any>) => any>,
  ): (...args: Array<any>) => any {
    return (...args) => {
      const tool = this.props.activeTool;
      const handler = toolToHandlerMap[tool.id];
      const fallbackHandler = toolToHandlerMap[AnnotationTool.MOVE.id];

      if (handler != null) {
        handler(...args);
      } else if (fallbackHandler != null) {
        fallbackHandler(...args);
      }
    };
  }

  render() {
    if (!this.planeView) {
      return null;
    }

    return (
      <TDController
        cameras={this.planeView.getCameras()}
        annotation={this.props.annotation}
        planeView={this.planeView}
      />
    );
  }
}

export function mapStateToProps(state: WebknossosState): StateProps {
  return {
    annotation: state.annotation,
    activeTool: state.uiInformation.activeTool,
  };
}

const connector = connect(mapStateToProps);
export default connector(PlaneController);
