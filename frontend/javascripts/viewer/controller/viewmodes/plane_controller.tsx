import app from "app";
import {
  InputKeyboard,
  InputKeyboardNoLoop,
  InputMouse,
  type KeyBindingLoopMap,
  type MouseBindingMap,
  type MouseEventHandler,
} from "libs/input";
import { isNoElementFocused, waitForElementWithId } from "libs/utils";
import { document } from "libs/window";
import union from "lodash-es/union";
import { PureComponent } from "react";
import { connect } from "react-redux";
import { userSettings } from "types/schemas/user_settings.schema";
import type { OrthoView, OrthoViewMap } from "viewer/constants";
import { OrthoViews, OrthoViewValuesWithoutTDView } from "viewer/constants";
import { moveU, moveV, moveW, zoom } from "viewer/controller/combinations/move_handlers";
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
import getSceneController, {
  getSceneControllerOrNull,
} from "viewer/controller/scene_controller_provider";
import TDController from "viewer/controller/td_controller";
import { getMoveOffset, getPosition } from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool, type AnnotationToolId } from "viewer/model/accessors/tool_accessor";
import { getMaximumBrushSize } from "viewer/model/accessors/volumetracing_accessor";
import {
  pitchFlycamAction,
  rollFlycamAction,
  yawFlycamAction,
} from "viewer/model/actions/flycam_actions";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import { cycleToolAction, enterAction, escapeAction } from "viewer/model/actions/ui_actions";
import { setViewportAction } from "viewer/model/actions/view_mode_actions";
import Dimensions from "viewer/model/dimensions";
import dimensions, { type DimensionIndices } from "viewer/model/dimensions";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import type { BrushPresets, StoreAnnotation, WebknossosState } from "viewer/store";
import Store from "viewer/store";
import { getDefaultBrushSizes } from "viewer/view/action_bar/tools/brush_presets";
import { loadKeyboardShortcuts } from "viewer/view/keyboard_shortcuts/keyboard_shortcut_persistence";
import type {
  KeyboardShortcutLoopedHandlerMap,
  KeyboardShortcutNoLoopedHandlerMap,
} from "viewer/view/keyboard_shortcuts/keyboard_shortcut_types";
import {
  buildKeyBindingsFromConfigAndLoopedMapping,
  buildKeyBindingsFromConfigAndMapping,
} from "viewer/view/keyboard_shortcuts/keyboard_shortcut_utils";
import {
  PlaneControllerLoopDelayedNavigationKeyboardShortcuts,
  PlaneControllerLoopedNavigationKeyboardShortcuts,
  PlaneControllerNoLoopGeneralKeyboardShortcuts,
} from "viewer/view/keyboard_shortcuts/plane_mode/general_keyboard_shortcuts_constants";
import PlaneView from "viewer/view/plane_view";
import { downloadScreenshot } from "viewer/view/rendering_utils";

const FIXED_ROTATION_STEP = Math.PI / 2;

const cycleTools = () => {
  Store.dispatch(cycleToolAction());
};

const cycleToolsBackwards = () => {
  Store.dispatch(cycleToolAction(true));
};

type StateProps = {
  annotation: StoreAnnotation;
  activeTool: AnnotationTool;
};
type Props = StateProps;

function createDelayAwareMoveHandler(
  multiplier: number,
  useDynamicSpaceDirection: boolean = false,
) {
  // The multiplier can be used for inverting the direction as well as for
  // speeding up the movement as it's done for shift+f, for example.
  const fn = (timeFactor: number, first: boolean) =>
    moveW(
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

class PlaneController extends PureComponent<Props> {
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
  // TODOM: improve typing
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
      waitForElementWithId(inputcatcherId).then((el) => {
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
    const skeletonControls = SkeletonToolController.getMouseControls(planeId, this.planeView);
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

    const getMouseControlKeys = (controls: MouseBindingMap) =>
      Object.keys(controls) as (keyof MouseBindingMap)[];

    const allControlKeys = union(
      getMouseControlKeys(moveControls),
      getMouseControlKeys(skeletonControls),
      getMouseControlKeys(drawControls),
      getMouseControlKeys(eraseControls),
      getMouseControlKeys(fillCellControls),
      getMouseControlKeys(voxelPipetteControls),
      getMouseControlKeys(boundingBoxControls),
      getMouseControlKeys(quickSelectControls),
      getMouseControlKeys(proofreadControls),
      getMouseControlKeys(lineMeasurementControls),
      getMouseControlKeys(areaMeasurementControls),
    );

    const controls: MouseBindingMap = {};

    for (const controlKey of allControlKeys) {
      controls[controlKey] = this.createToolDependentMouseHandler({
        [AnnotationTool.MOVE.id]: moveControls[controlKey],
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
      [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_LEFT]: {
        onPressedWithRepeat: (timeFactor: number) =>
          moveU(-getMoveOffset(Store.getState(), timeFactor)),
      },
      [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_RIGHT]: {
        onPressedWithRepeat: (timeFactor: number) =>
          moveU(getMoveOffset(Store.getState(), timeFactor)),
      },
      [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_UP]: {
        onPressedWithRepeat: (timeFactor: number) =>
          moveV(-getMoveOffset(Store.getState(), timeFactor)),
      },
      [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_DOWN]: {
        onPressedWithRepeat: (timeFactor: number) =>
          moveV(getMoveOffset(Store.getState(), timeFactor)),
      },
      [PlaneControllerLoopedNavigationKeyboardShortcuts.YAW_LEFT]: {
        onPressedWithRepeat: (timeFactor: number) => rotateViewportAware(timeFactor, 1, false),
      },
      [PlaneControllerLoopedNavigationKeyboardShortcuts.YAW_RIGHT]: {
        onPressedWithRepeat: (timeFactor: number) => rotateViewportAware(timeFactor, 1, true),
      },
      [PlaneControllerLoopedNavigationKeyboardShortcuts.PITCH_UP]: {
        onPressedWithRepeat: (timeFactor: number) => rotateViewportAware(timeFactor, 0, false),
      },
      [PlaneControllerLoopedNavigationKeyboardShortcuts.PITCH_DOWN]: {
        onPressedWithRepeat: (timeFactor: number) => rotateViewportAware(timeFactor, 0, true),
      },
      [PlaneControllerLoopedNavigationKeyboardShortcuts.ALT_ROLL_LEFT]: {
        onPressedWithRepeat: (timeFactor: number) => rotateViewportAware(timeFactor, 2, false),
      },
      [PlaneControllerLoopedNavigationKeyboardShortcuts.ALT_ROLL_RIGHT]: {
        onPressedWithRepeat: (timeFactor: number) => rotateViewportAware(timeFactor, 2, true),
      },
    } as KeyboardShortcutLoopedHandlerMap<PlaneControllerLoopedNavigationKeyboardShortcuts>;
  }

  getLoopDelayedHandlerMap(): KeyboardShortcutLoopedHandlerMap<PlaneControllerLoopDelayedNavigationKeyboardShortcuts> {
    return {
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_MULTIPLE_FORWARD]: {
        onPressedWithRepeat: createDelayAwareMoveHandler(5, true),
      },
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_MULTIPLE_BACKWARD]: {
        onPressedWithRepeat: createDelayAwareMoveHandler(-5, true),
      },
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_ONE_BACKWARD]: {
        onPressedWithRepeat: createDelayAwareMoveHandler(-1),
      },
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_ONE_FORWARD]: {
        onPressedWithRepeat: createDelayAwareMoveHandler(1),
      },
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_ONE_FORWARD_DIRECTION_AWARE]: {
        onPressedWithRepeat: createDelayAwareMoveHandler(1, true),
      },
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_ONE_BACKWARD_DIRECTION_AWARE]: {
        onPressedWithRepeat: createDelayAwareMoveHandler(-1, true),
      },
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.ZOOM_IN_PLANE]: {
        onPressedWithRepeat: () => zoom(1, false),
      },
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.ZOOM_OUT_PLANE]: {
        onPressedWithRepeat: () => zoom(-1, false),
      },
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.INCREASE_MOVE_VALUE_PLANE]: {
        onPressedWithRepeat: () => this.changeMoveValue(25),
      },
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.DECREASE_MOVE_VALUE_PLANE]: {
        onPressedWithRepeat: () => this.changeMoveValue(-25),
      },
    } as KeyboardShortcutLoopedHandlerMap<PlaneControllerLoopDelayedNavigationKeyboardShortcuts>;
  }

  getNoLoopHandlerMap(): KeyboardShortcutNoLoopedHandlerMap<PlaneControllerNoLoopGeneralKeyboardShortcuts> {
    return {
      [PlaneControllerNoLoopGeneralKeyboardShortcuts.DOWNLOAD_SCREENSHOT]: {
        onPressed: () => downloadScreenshot(),
      },
      [PlaneControllerNoLoopGeneralKeyboardShortcuts.CYCLE_TOOLS]: {
        onPressed: () => cycleTools(),
      },
      [PlaneControllerNoLoopGeneralKeyboardShortcuts.CYCLE_TOOLS_BACKWARDS]: {
        onPressed: () => cycleToolsBackwards(),
      },
    } as KeyboardShortcutNoLoopedHandlerMap<PlaneControllerNoLoopGeneralKeyboardShortcuts>;
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
    const withAdditionalActions: KeyBindingLoopMap = {
      ...delayedBindings,
      // Enter & Escape need to be separate due to being constant and not configurable.
      enter: {
        onPressedWithRepeat: (_, _isOriginalEvent, event) => Store.dispatch(enterAction(event)),
      },
      esc: { onPressedWithRepeat: () => Store.dispatch(escapeAction()) },
    };
    this.input.keyboardLoopDelayed = new InputKeyboard(withAdditionalActions, {
      delay: Store.getState().userConfiguration.keyboardDelay,
    });

    // no-loop keyboard
    const noLoopBindings = buildKeyBindingsFromConfigAndMapping(
      keybindingConfig,
      this.getNoLoopHandlerMap(),
    );

    // TODO: migrate to keystrokes and implement tool dependant keyboard shortcuts.

    this.input.keyboardNoLoop = new InputKeyboardNoLoop(noLoopBindings, {});
  }

  initKeyboard(): void {
    // avoid scrolling while pressing space
    document.addEventListener("keydown", (event: KeyboardEvent) => {
      if (
        (event.which === 32 || event.which === 18 || (event.which >= 37 && event.which <= 40)) &&
        isNoElementFocused()
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
    } catch (_e) {
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
    this.storePropertyUnsubscribers.forEach((unsubscribe) => {
      unsubscribe();
    });
    this.storePropertyUnsubscribers = [];
  }

  destroyInput() {
    for (const mouse of Object.values(this.input.mouseControllers)) {
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

  createToolDependentMouseHandler<T extends MouseEventHandler = MouseEventHandler>(
    toolToHandlerMap: Record<AnnotationToolId, T | undefined>,
  ): (...args: Parameters<T>) => void {
    return (...args: Parameters<T>) => {
      const tool = this.props.activeTool;
      const handler = toolToHandlerMap[tool.id] as T | undefined;
      const fallbackHandler = toolToHandlerMap[AnnotationTool.MOVE.id] as T | undefined;

      if (handler != null) {
        // @ts-expect-error Typescript is too strict to allow spreading the parameters here.
        handler(...args);
      } else if (fallbackHandler != null) {
        // @ts-expect-error Typescript is too strict to allow spreading the parameters here.
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

function mapStateToProps(state: WebknossosState): StateProps {
  return {
    annotation: state.annotation,
    activeTool: state.uiInformation.activeTool,
  };
}

const connector = connect(mapStateToProps);
export default connector(PlaneController);
