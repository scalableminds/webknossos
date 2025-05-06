import { InputKeyboard, InputKeyboardNoLoop, InputMouse, type MouseBindingMap } from "libs/input";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import { document } from "libs/window";
import _ from "lodash";
import type { OrthoView, OrthoViewMap } from "oxalis/constants";
import { OrthoViewValuesWithoutTDView, OrthoViews } from "oxalis/constants";
import * as MoveHandlers from "oxalis/controller/combinations/move_handlers";
import * as SkeletonHandlers from "oxalis/controller/combinations/skeleton_handlers";
import {
  AreaMeasurementToolController,
  BoundingBoxToolController,
  DrawToolController,
  EraseToolController,
  FillCellToolController,
  LineMeasurementToolController,
  MoveToolController,
  PickCellToolController,
  ProofreadToolController,
  QuickSelectToolController,
  SkeletonToolController,
} from "oxalis/controller/combinations/tool_controls";
import * as VolumeHandlers from "oxalis/controller/combinations/volume_handlers";
import getSceneController, {
  getSceneControllerOrNull,
} from "oxalis/controller/scene_controller_provider";
import TDController from "oxalis/controller/td_controller";
import {
  getActiveMagIndexForLayer,
  getMoveOffset,
  getPosition,
} from "oxalis/model/accessors/flycam_accessor";
import { AnnotationTool, type AnnotationToolId } from "oxalis/model/accessors/tool_accessor";
import { calculateGlobalPos } from "oxalis/model/accessors/view_mode_accessor";
import {
  getActiveSegmentationTracing,
  getMaximumBrushSize,
} from "oxalis/model/accessors/volumetracing_accessor";
import { addUserBoundingBoxAction } from "oxalis/model/actions/annotation_actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import {
  createBranchPointAction,
  createTreeAction,
  deleteNodeAsUserAction,
  requestDeleteBranchPointAction,
  toggleAllTreesAction,
  toggleInactiveTreesAction,
} from "oxalis/model/actions/skeletontracing_actions";
import {
  cycleToolAction,
  enterAction,
  escapeAction,
  setToolAction,
} from "oxalis/model/actions/ui_actions";
import { setViewportAction } from "oxalis/model/actions/view_mode_actions";
import {
  createCellAction,
  interpolateSegmentationLayerAction,
} from "oxalis/model/actions/volumetracing_actions";
import dimensions from "oxalis/model/dimensions";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { Model, api } from "oxalis/singletons";
import type { BrushPresets, StoreAnnotation, WebknossosState } from "oxalis/store";
import Store from "oxalis/store";
import { getDefaultBrushSizes } from "oxalis/view/action-bar/tools/brush_presets";
import { showToastWarningForLargestSegmentIdMissing } from "oxalis/view/largest_segment_id_modal";
import PlaneView from "oxalis/view/plane_view";
import { downloadScreenshot } from "oxalis/view/rendering_utils";
import * as React from "react";
import { connect } from "react-redux";
import { userSettings } from "types/schemas/user_settings.schema";
import { highlightAndSetCursorOnHoveredBoundingBox } from "../combinations/bounding_box_handlers";

function ensureNonConflictingHandlers(
  skeletonControls: Record<string, any>,
  volumeControls: Record<string, any>,
): void {
  const conflictingHandlers = _.intersection(
    Object.keys(skeletonControls),
    Object.keys(volumeControls),
  );

  if (conflictingHandlers.length > 0) {
    throw new Error(
      `There are unsolved conflicts between skeleton and volume controller: ${conflictingHandlers.join(
        ", ",
      )}`,
    );
  }
}

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
  static getKeyboardControls() {
    return {
      "1": () => Store.dispatch(toggleAllTreesAction()),
      "2": () => Store.dispatch(toggleInactiveTreesAction()),
      // Delete active node
      delete: () => Store.dispatch(deleteNodeAsUserAction(Store.getState())),
      backspace: () => Store.dispatch(deleteNodeAsUserAction(Store.getState())),
      c: () => Store.dispatch(createTreeAction()),
      e: () => SkeletonHandlers.moveAlongDirection(),
      r: () => SkeletonHandlers.moveAlongDirection(true),
      // Branches
      b: () => Store.dispatch(createBranchPointAction()),
      j: () => Store.dispatch(requestDeleteBranchPointAction()),
      s: () => {
        api.tracing.centerNode();
        api.tracing.centerTDView();
      },
      // navigate nodes
      "ctrl + ,": () => SkeletonHandlers.toPrecedingNode(),
      "ctrl + .": () => SkeletonHandlers.toSubsequentNode(),
    };
  }

  static getLoopedKeyboardControls() {
    return {
      "ctrl + left": () => SkeletonHandlers.moveNode(-1, 0),
      "ctrl + right": () => SkeletonHandlers.moveNode(1, 0),
      "ctrl + up": () => SkeletonHandlers.moveNode(0, -1),
      "ctrl + down": () => SkeletonHandlers.moveNode(0, 1),
    };
  }

  static getExtendedKeyboardControls() {
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
      p: () => setTool(AnnotationTool.PICK_CELL),
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

function createDelayAwareMoveHandler(multiplier: number) {
  // The multiplier can be used for inverting the direction as well as for
  // speeding up the movement as it's done for shift+f, for example.
  const fn = (timeFactor: number, first: boolean) =>
    MoveHandlers.moveW(getMoveOffset(Store.getState(), timeFactor) * multiplier, first);

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

    if (state.userConfiguration.dynamicSpaceDirection) {
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
    const pickCellControls = PickCellToolController.getPlaneMouseControls(planeId);
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
      Object.keys(pickCellControls),
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
        [AnnotationTool.PICK_CELL.id]: pickCellControls[controlKey],
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
    this.input.keyboard = new InputKeyboard({
      // Move
      left: (timeFactor) => MoveHandlers.moveU(-getMoveOffset(Store.getState(), timeFactor)),
      right: (timeFactor) => MoveHandlers.moveU(getMoveOffset(Store.getState(), timeFactor)),
      up: (timeFactor) => MoveHandlers.moveV(-getMoveOffset(Store.getState(), timeFactor)),
      down: (timeFactor) => MoveHandlers.moveV(getMoveOffset(Store.getState(), timeFactor)),
    });
    const {
      baseControls: notLoopedKeyboardControls,
      keyUpControls,
      extendedControls: extendedNotLoopedKeyboardControls,
    } = this.getNotLoopedKeyboardControls();
    const loopedKeyboardControls = this.getLoopedKeyboardControls();
    ensureNonConflictingHandlers(notLoopedKeyboardControls, loopedKeyboardControls);
    this.input.keyboardLoopDelayed = new InputKeyboard(
      {
        // KeyboardJS is sensitive to ordering (complex combos first)
        "shift + i": () => VolumeHandlers.changeBrushSizeIfBrushIsActiveBy(-1),
        "shift + o": () => VolumeHandlers.changeBrushSizeIfBrushIsActiveBy(1),
        "shift + f": createDelayAwareMoveHandler(5),
        "shift + d": createDelayAwareMoveHandler(-5),
        "shift + space": createDelayAwareMoveHandler(-1),
        "ctrl + space": createDelayAwareMoveHandler(-1),
        enter: () => Store.dispatch(enterAction()),
        esc: () => Store.dispatch(escapeAction()),
        space: createDelayAwareMoveHandler(1),
        f: createDelayAwareMoveHandler(1),
        d: createDelayAwareMoveHandler(-1),
        // Zoom in/out
        i: () => MoveHandlers.zoom(1, false),
        o: () => MoveHandlers.zoom(-1, false),
        h: () => this.changeMoveValue(25),
        g: () => this.changeMoveValue(-25),
        ...loopedKeyboardControls,
      },
      {
        delay: Store.getState().userConfiguration.keyboardDelay,
      },
    );
    this.input.keyboardNoLoop = new InputKeyboardNoLoop(
      notLoopedKeyboardControls,
      {},
      extendedNotLoopedKeyboardControls,
      keyUpControls,
    );
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
          const globalMousePosition = calculateGlobalPos(Store.getState(), {
            x,
            y,
          });
          const { cube } = segmentationLayer;
          const mapping = event.altKey ? cube.getMapping() : null;
          const hoveredId = cube.getDataValue(
            globalMousePosition,
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
    ensureNonConflictingHandlers(skeletonControls, volumeControls);
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
