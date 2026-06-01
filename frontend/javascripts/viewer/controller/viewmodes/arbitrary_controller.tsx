import type { ModifierKeys } from "libs/input";
import { InputKeyboard, InputMouse } from "libs/input";
import type { Matrix4x4 } from "libs/mjs";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import { clamp, waitForElementWithId } from "libs/utils";
import messages from "messages";
import React from "react";
import type { Point2, Vector3, ViewMode, Viewport } from "viewer/constants";
import constants, { FlightViewport } from "viewer/constants";
import getSceneController from "viewer/controller/scene_controller_provider";
import TDController from "viewer/controller/td_controller";
import ArbitraryPlane from "viewer/geometries/arbitrary_plane";
import Crosshair from "viewer/geometries/crosshair";
import {
  getMoveOffset3d,
  getPosition,
  getRotationInDegrees,
} from "viewer/model/accessors/flycam_accessor";
import {
  getActiveNode,
  getMaxNodeId,
  getNodePosition,
  untransformNodePosition,
} from "viewer/model/accessors/skeletontracing_accessor";
import {
  moveFlycamAction,
  pitchFlycamAction,
  yawFlycamAction,
  zoomInAction,
  zoomOutAction,
} from "viewer/model/actions/flycam_actions";
import {
  setFlightmodeRecordingAction,
  updateUserSettingAction,
} from "viewer/model/actions/settings_actions";
import {
  createBranchPointAction,
  createNodeAction,
  createTreeAction,
  requestDeleteBranchPointAction,
  setActiveNodeAction,
} from "viewer/model/actions/skeletontracing_actions";
import { deleteNodeAsUserAction } from "viewer/model/actions/skeletontracing_actions_with_effects";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import { api } from "viewer/singletons";
import Store from "viewer/store";
import ArbitraryView from "viewer/view/arbitrary_view";
import type {
  KeyboardShortcutHandlerMap,
  KeyboardShortcutsMap,
} from "viewer/view/keyboard_shortcuts/keyboard_shortcut_types";
import { buildKeyBindingsFromConfig } from "viewer/view/keyboard_shortcuts/keyboard_shortcut_utils";
import { downloadScreenshot } from "viewer/view/rendering_utils";
import { SkeletonToolController } from "../combinations/tool_controls";

const flightViewportId = "inputcatcher_flightViewport";
type Props = {
  viewMode: ViewMode;
};

class ArbitraryController extends React.PureComponent<Props> {
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'arbitraryView' has no initializer and is... Remove this comment to see the full error message
  arbitraryView: ArbitraryView;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'isStarted' has no initializer and is not... Remove this comment to see the full error message
  isStarted: boolean;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'plane' has no initializer and is not def... Remove this comment to see the full error message
  plane: ArbitraryPlane;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'crosshair' has no initializer and is not... Remove this comment to see the full error message
  crosshair: Crosshair;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'lastNodeMatrix' has no initializer and i... Remove this comment to see the full error message
  lastNodeMatrix: Matrix4x4;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'input' has no initializer and is not def... Remove this comment to see the full error message
  input: {
    mouseController: InputMouse | null | undefined;
    keyboard?: InputKeyboard;
  };

  // @ts-expect-error ts-migrate(2564) FIXME: Property 'storePropertyUnsubscribers' has no initi... Remove this comment to see the full error message
  storePropertyUnsubscribers: Array<(...args: Array<any>) => any>;

  componentDidMount() {
    this.input = {
      mouseController: null,
    };
    this.storePropertyUnsubscribers = [];
    this.start();
  }

  componentWillUnmount() {
    this.stop();
  }

  initMouse(): void {
    waitForElementWithId(flightViewportId).then(() => {
      this.input.mouseController = new InputMouse(
        flightViewportId,
        {
          leftClick: (pos: Point2, viewport: string, event: MouseEvent, isTouch: boolean) => {
            SkeletonToolController.onLeftClick(
              this.arbitraryView,
              pos,
              event.shiftKey,
              event.altKey,
              event.ctrlKey || event.metaKey,
              viewport as Viewport,
              isTouch,
              false,
            );
          },
          leftDownMove: (delta: Point2) => {
            Store.dispatch(
              yawFlycamAction(delta.x * Store.getState().userConfiguration.mouseRotateValue, true),
            );
            Store.dispatch(
              pitchFlycamAction(
                delta.y * -1 * Store.getState().userConfiguration.mouseRotateValue,
                true,
              ),
            );
          },
          scroll: this.scroll,
          pinch: (delta: number) => {
            if (delta < 0) {
              Store.dispatch(zoomOutAction());
            } else {
              Store.dispatch(zoomInAction());
            }
          },
        },
        FlightViewport,
      );
    });
  }

  getHandlerMap(): Partial<KeyboardShortcutHandlerMap> {
    const getRotateValue = () => Store.getState().userConfiguration.rotateValue;
    return {
      // Looped navigation (no delay)
      MOVE_FORWARD_WITH_RECORDING: {
        onPressedWithRepeat: (timeFactor: number) => {
          this.setRecord(true);
          this.move(timeFactor);
        },
      },
      MOVE_BACKWARD_WITH_RECORDING: {
        onPressedWithRepeat: (timeFactor: number) => {
          this.setRecord(true);
          this.move(-timeFactor);
        },
      },
      MOVE_FORWARD_WITHOUT_RECORDING: {
        onPressedWithRepeat: (timeFactor: number) => {
          this.setRecord(false);
          this.move(timeFactor);
        },
      },
      MOVE_BACKWARD_WITHOUT_RECORDING: {
        onPressedWithRepeat: (timeFactor: number) => {
          this.setRecord(false);
          this.move(-timeFactor);
        },
      },
      YAW_FLYCAM_POSITIVE_AT_CENTER: {
        onPressedWithRepeat: (timeFactor: number) => {
          Store.dispatch(yawFlycamAction(getRotateValue() * timeFactor));
        },
      },
      YAW_FLYCAM_INVERTED_AT_CENTER: {
        onPressedWithRepeat: (timeFactor: number) => {
          Store.dispatch(yawFlycamAction(-getRotateValue() * timeFactor));
        },
      },
      PITCH_FLYCAM_POSITIVE_AT_CENTER: {
        onPressedWithRepeat: (timeFactor: number) => {
          Store.dispatch(pitchFlycamAction(getRotateValue() * timeFactor));
        },
      },
      PITCH_FLYCAM_INVERTED_AT_CENTER: {
        onPressedWithRepeat: (timeFactor: number) => {
          Store.dispatch(pitchFlycamAction(-getRotateValue() * timeFactor));
        },
      },
      YAW_FLYCAM_POSITIVE_IN_DISTANCE: {
        onPressedWithRepeat: (timeFactor: number) => {
          Store.dispatch(yawFlycamAction(getRotateValue() * timeFactor, true));
        },
      },
      YAW_FLYCAM_INVERTED_IN_DISTANCE: {
        onPressedWithRepeat: (timeFactor: number) => {
          Store.dispatch(yawFlycamAction(-getRotateValue() * timeFactor, true));
        },
      },
      PITCH_FLYCAM_POSITIVE_IN_DISTANCE: {
        onPressedWithRepeat: (timeFactor: number) => {
          Store.dispatch(pitchFlycamAction(-getRotateValue() * timeFactor, true));
        },
      },
      PITCH_FLYCAM_INVERTED_IN_DISTANCE: {
        onPressedWithRepeat: (timeFactor: number) => {
          Store.dispatch(pitchFlycamAction(getRotateValue() * timeFactor, true));
        },
      },
      ZOOM_IN_FLIGHT: {
        onPressedWithRepeat: () => {
          Store.dispatch(zoomInAction());
        },
      },
      ZOOM_OUT_FLIGHT: {
        onPressedWithRepeat: () => {
          Store.dispatch(zoomOutAction());
        },
      },
      // Looped navigation with delay
      INCREASE_MOVE_VALUE_FLIGHT: {
        onPressedWithRepeat: () => this.changeMoveValue(25),
        delayed: true,
      },
      DECREASE_MOVE_VALUE_FLIGHT: {
        onPressedWithRepeat: () => this.changeMoveValue(-25),
        delayed: true,
      },
      // No-loop shortcuts
      DELETE_ACTIVE_NODE: {
        onPressed: () => {
          Store.dispatch(deleteNodeAsUserAction(Store.getState()));
        },
      },
      CREATE_TREE_FLIGHT: {
        onPressed: () => {
          Store.dispatch(createTreeAction());
        },
      },
      CREATE_BRANCH_POINT_FLIGHT: {
        onPressed: () => {
          this.pushBranch();
        },
      },
      DELETE_BRANCH_POINT_FLIGHT: {
        onPressed: () => {
          Store.dispatch(requestDeleteBranchPointAction());
        },
      },
      RECENTER_ACTIVE_NODE_FLIGHT: {
        onPressed: () => {
          const state = Store.getState();
          const skeletonTracing = state.annotation.skeleton;

          if (!skeletonTracing) {
            return;
          }

          const activeNode = getActiveNode(skeletonTracing);
          if (activeNode) {
            api.tracing.centerPositionAnimated(
              getNodePosition(activeNode, state),
              false,
              activeNode.rotation,
              true,
            );
          }
        },
      },
      NEXT_NODE_FORWARD_FLIGHT: {
        onPressed: () => {
          this.nextNode(true);
        },
      },
      NEXT_NODE_BACKWARD_FLIGHT: {
        onPressed: () => {
          this.nextNode(false);
        },
      },
      ROTATE_VIEW_180: {
        onPressed: () => {
          Store.dispatch(yawFlycamAction(Math.PI));
        },
      },
      DOWNLOAD_SCREENSHOT_FLIGHT: {
        onPressed: downloadScreenshot,
      },
    };
  }

  reloadKeyboardShortcuts(keyboardShortcutsConfig: KeyboardShortcutsMap) {
    this.input.keyboard?.destroy();
    const bindings = buildKeyBindingsFromConfig(keyboardShortcutsConfig, this.getHandlerMap());
    this.input.keyboard = new InputKeyboard(bindings);
  }

  initKeyboard(): void {
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (state) => state.keyboardConfiguration.shortcutsConfig,
        (keyboardShortcutsConfig) => this.reloadKeyboardShortcuts(keyboardShortcutsConfig),
        true,
      ),
    );
  }

  setRecord(record: boolean): void {
    if (record !== Store.getState().temporaryConfiguration.flightmodeRecording) {
      Store.dispatch(setFlightmodeRecordingAction(record));
      this.handleCreateNode();
    }
  }

  nextNode(nextOne: boolean): void {
    const skeletonTracing = Store.getState().annotation.skeleton;

    if (!skeletonTracing) {
      return;
    }

    const activeNode = getActiveNode(skeletonTracing);
    const maxNodeId = getMaxNodeId(skeletonTracing);
    if (activeNode == null || maxNodeId == null) {
      return;
    }
    if ((nextOne && activeNode.id === maxNodeId) || (!nextOne && activeNode.id === 1)) {
      return;
    }
    // implicit cast from boolean to int
    Store.dispatch(
      setActiveNodeAction(activeNode.id + 2 * Number(nextOne) - 1, false, false, false),
    );
  }

  move(timeFactor: number): void {
    if (!this.isStarted) {
      return;
    }
    Store.dispatch(moveFlycamAction([0, 0, getMoveOffset3d(Store.getState(), timeFactor)]));
    this.moved();
  }

  init(): void {
    const { clippingDistanceFlight } = Store.getState().userConfiguration;
    this.setClippingDistance(clippingDistanceFlight);
  }

  bindToEvents(): void {
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (state) => state.userConfiguration,
        (userConfiguration) => {
          const { clippingDistanceFlight, displayCrosshair, crosshairSize } = userConfiguration;
          this.setClippingDistance(clippingDistanceFlight);
          this.crosshair.setScale(crosshairSize);
          this.crosshair.setVisibility(displayCrosshair);
          this.arbitraryView.resizeThrottled();
        },
      ),
      listenToStoreProperty(
        (state) => state.datasetConfiguration.interpolation,
        (interpolation) => this.plane.setLinearInterpolationEnabled(interpolation),
      ),
      listenToStoreProperty(
        (state) => state.temporaryConfiguration.flightmodeRecording,
        (isRecording) => {
          if (isRecording) {
            // This listener is responsible for setting a new waypoint, when the user enables
            // the "flightmode recording" toggle in the top-left corner of the flight canvas.
            this.handleCreateNode();
          }
        },
      ),
    );
  }

  start(): void {
    this.arbitraryView = new ArbitraryView();
    this.arbitraryView.start();
    this.plane = new ArbitraryPlane();
    this.crosshair = new Crosshair(Store.getState().userConfiguration.crosshairSize);
    this.crosshair.setVisibility(Store.getState().userConfiguration.displayCrosshair);
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'ArbitraryPlane' is not assignabl... Remove this comment to see the full error message
    this.arbitraryView.addGeometry(this.plane);
    this.arbitraryView.setArbitraryPlane(this.plane);
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'Crosshair' is not assignable to ... Remove this comment to see the full error message
    this.arbitraryView.addGeometry(this.crosshair);
    this.bindToEvents();
    this.initKeyboard();
    this.initMouse();
    this.init();
    const { clippingDistance } = Store.getState().userConfiguration;
    getSceneController().setClippingDistance(clippingDistance);
    this.arbitraryView.draw();
    this.isStarted = true;
    this.forceUpdate();
  }

  unsubscribeStoreListeners() {
    this.storePropertyUnsubscribers.forEach((unsubscribe) => {
      unsubscribe();
    });
    this.storePropertyUnsubscribers = [];
  }

  stop(): void {
    this.unsubscribeStoreListeners();

    if (this.isStarted) {
      this.destroyInput();
    }

    this.arbitraryView.stop();
    this.plane.stop();
    this.isStarted = false;
  }

  scroll = (delta: number, type: ModifierKeys | null | undefined) => {
    if (type === "shift") {
      this.setParticleSize(clamp(-1, delta, 1));
    }
  };

  destroyInput() {
    this.input.mouseController?.destroy();
    this.input.keyboard?.destroy();
  }

  handleCreateNode(): void {
    if (!Store.getState().temporaryConfiguration.flightmodeRecording) {
      return;
    }
    const state = Store.getState();
    const position = getPosition(state.flycam);
    const rotation = getRotationInDegrees(state.flycam);
    const additionalCoordinates = state.flycam.additionalCoordinates;
    Store.dispatch(
      createNodeAction(
        untransformNodePosition(position, state),
        additionalCoordinates,
        rotation,
        constants.FLIGHT_VIEW,
        0,
      ),
    );
  }

  changeMoveValue(delta: number): void {
    const moveValue = Store.getState().userConfiguration.moveValue3d + delta;
    Store.dispatch(updateUserSettingAction("moveValue3d", moveValue));
  }

  setParticleSize(delta: number): void {
    const particleSize = Store.getState().userConfiguration.particleSize + delta;
    Store.dispatch(updateUserSettingAction("particleSize", particleSize));
  }

  setClippingDistance(value: number): void {
    this.arbitraryView.setClippingDistance(value);
  }

  pushBranch(): void {
    if (!Store.getState().annotation.skeleton) {
      return;
    }

    // Consider for deletion
    this.handleCreateNode();
    Store.dispatch(createBranchPointAction());
    Toast.success(messages["tracing.branchpoint_set"]);
  }

  moved(): void {
    const matrix = Store.getState().flycam.currentMatrix;

    if (this.lastNodeMatrix == null) {
      this.lastNodeMatrix = matrix;
    }

    const { lastNodeMatrix } = this;
    const vector: Vector3 = [
      lastNodeMatrix[12] - matrix[12],
      lastNodeMatrix[13] - matrix[13],
      lastNodeMatrix[14] - matrix[14],
    ];
    const vectorLength = V3.length(vector);

    if (vectorLength > 10) {
      this.handleCreateNode();
      this.lastNodeMatrix = matrix;
    }
  }

  render() {
    if (!this.arbitraryView) {
      return null;
    }

    return <TDController cameras={this.arbitraryView.getCameras()} />;
  }
}

export default ArbitraryController;
