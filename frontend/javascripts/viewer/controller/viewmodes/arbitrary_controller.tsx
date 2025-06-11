import type { ModifierKeys } from "libs/input";
import { InputKeyboard, InputKeyboardNoLoop, InputMouse } from "libs/input";
import type { Matrix4x4 } from "libs/mjs";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import messages from "messages";
import * as React from "react";
import type { Point2, Vector3, ViewMode, Viewport } from "viewer/constants";
import constants, { ArbitraryViewport } from "viewer/constants";
import getSceneController from "viewer/controller/scene_controller_provider";
import TDController from "viewer/controller/td_controller";
import ArbitraryPlane from "viewer/geometries/arbitrary_plane";
import Crosshair from "viewer/geometries/crosshair";
import { getMoveOffset3d, getPosition, getRotation } from "viewer/model/accessors/flycam_accessor";
import {
  getActiveNode,
  getMaxNodeId,
  getNodePosition,
  untransformNodePosition,
} from "viewer/model/accessors/skeletontracing_accessor";
import { getViewportScale } from "viewer/model/accessors/view_mode_accessor";
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
  toggleAllTreesAction,
  toggleInactiveTreesAction,
} from "viewer/model/actions/skeletontracing_actions";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import { api } from "viewer/singletons";
import Store from "viewer/store";
import ArbitraryView from "viewer/view/arbitrary_view";
import { downloadScreenshot } from "viewer/view/rendering_utils";
import { SkeletonToolController } from "../combinations/tool_controls";
import { deleteNodeAsUserAction } from "viewer/model/actions/skeletontracing_actions_with_effects";

const arbitraryViewportId = "inputcatcher_arbitraryViewport";
type Props = {
  viewMode: ViewMode;
};

class ArbitraryController extends React.PureComponent<Props> {
  // See comment in Controller class on general controller architecture.
  //
  // Arbitrary Controller: Responsible for Arbitrary Modes
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
    keyboardLoopDelayed?: InputKeyboard;
    keyboardNoLoop?: InputKeyboardNoLoop;
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
    Utils.waitForElementWithId(arbitraryViewportId).then(() => {
      this.input.mouseController = new InputMouse(
        arbitraryViewportId,
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
            if (this.props.viewMode === constants.MODE_ARBITRARY) {
              Store.dispatch(
                yawFlycamAction(
                  delta.x * Store.getState().userConfiguration.mouseRotateValue,
                  true,
                ),
              );
              Store.dispatch(
                pitchFlycamAction(
                  delta.y * -1 * Store.getState().userConfiguration.mouseRotateValue,
                  true,
                ),
              );
            } else if (this.props.viewMode === constants.MODE_ARBITRARY_PLANE) {
              const [scaleX, scaleY] = getViewportScale(Store.getState(), ArbitraryViewport);
              const fx = Store.getState().flycam.zoomStep / scaleX;
              const fy = Store.getState().flycam.zoomStep / scaleY;
              Store.dispatch(moveFlycamAction([delta.x * fx, delta.y * fy, 0]));
            }
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
        ArbitraryViewport,
      );
    });
  }

  initKeyboard(): void {
    const getRotateValue = () => Store.getState().userConfiguration.rotateValue;

    const isArbitrary = () => this.props.viewMode === constants.MODE_ARBITRARY;

    this.input.keyboard = new InputKeyboard({
      // KeyboardJS is sensitive to ordering (complex combos first)
      // Move
      space: (timeFactor: number) => {
        this.setRecord(true);
        this.move(timeFactor);
      },
      "ctrl + space": (timeFactor: number) => {
        this.setRecord(true);
        this.move(-timeFactor);
      },
      f: (timeFactor: number) => {
        this.setRecord(false);
        this.move(timeFactor);
      },
      d: (timeFactor: number) => {
        this.setRecord(false);
        this.move(-timeFactor);
      },
      // Rotate at centre
      "shift + left": (timeFactor: number) => {
        Store.dispatch(yawFlycamAction(getRotateValue() * timeFactor));
      },
      "shift + right": (timeFactor: number) => {
        Store.dispatch(yawFlycamAction(-getRotateValue() * timeFactor));
      },
      "shift + up": (timeFactor: number) => {
        Store.dispatch(pitchFlycamAction(getRotateValue() * timeFactor));
      },
      "shift + down": (timeFactor: number) => {
        Store.dispatch(pitchFlycamAction(-getRotateValue() * timeFactor));
      },
      // Rotate in distance
      left: (timeFactor: number) => {
        Store.dispatch(yawFlycamAction(getRotateValue() * timeFactor, isArbitrary()));
      },
      right: (timeFactor: number) => {
        Store.dispatch(yawFlycamAction(-getRotateValue() * timeFactor, isArbitrary()));
      },
      up: (timeFactor: number) => {
        Store.dispatch(pitchFlycamAction(-getRotateValue() * timeFactor, isArbitrary()));
      },
      down: (timeFactor: number) => {
        Store.dispatch(pitchFlycamAction(getRotateValue() * timeFactor, isArbitrary()));
      },
      // Zoom in/out
      i: () => {
        Store.dispatch(zoomInAction());
      },
      o: () => {
        Store.dispatch(zoomOutAction());
      },
    });
    // Own InputKeyboard with delay for changing the Move Value, because otherwise the values changes to drastically
    this.input.keyboardLoopDelayed = new InputKeyboard(
      {
        h: () => this.changeMoveValue(25),
        g: () => this.changeMoveValue(-25),
      },
      {
        delay: Store.getState().userConfiguration.keyboardDelay,
      },
    );
    this.input.keyboardNoLoop = new InputKeyboardNoLoop({
      "1": () => {
        Store.dispatch(toggleAllTreesAction());
      },
      "2": () => {
        Store.dispatch(toggleInactiveTreesAction());
      },
      // Delete active node
      delete: () => {
        Store.dispatch(deleteNodeAsUserAction(Store.getState()));
      },
      backspace: () => {
        Store.dispatch(deleteNodeAsUserAction(Store.getState()));
      },
      c: () => {
        Store.dispatch(createTreeAction());
      },
      // Branches
      b: () => this.pushBranch(),
      j: () => {
        Store.dispatch(requestDeleteBranchPointAction());
      },
      // Recenter active node
      s: () => {
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
          );
        }
      },
      ".": () => this.nextNode(true),
      ",": () => this.nextNode(false),
      // Rotate view by 180 deg
      r: () => {
        Store.dispatch(yawFlycamAction(Math.PI));
      },
      // Delete active node and recenter last node
      "shift + space": () => {
        const skeletonTracing = Store.getState().annotation.skeleton;

        if (!skeletonTracing) {
          return;
        }

        Store.dispatch(deleteNodeAsUserAction(Store.getState()));
      },
      q: downloadScreenshot,
    });
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
    Store.dispatch(setActiveNodeAction(activeNode.id + 2 * Number(nextOne) - 1));
  }

  move(timeFactor: number): void {
    if (!this.isStarted) {
      return;
    }
    Store.dispatch(moveFlycamAction([0, 0, getMoveOffset3d(Store.getState(), timeFactor)]));
    this.moved();
  }

  init(): void {
    const { clippingDistanceArbitrary } = Store.getState().userConfiguration;
    this.setClippingDistance(clippingDistanceArbitrary);
  }

  bindToEvents(): void {
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (state) => state.userConfiguration,
        (userConfiguration) => {
          const { clippingDistanceArbitrary, displayCrosshair, crosshairSize } = userConfiguration;
          this.setClippingDistance(clippingDistanceArbitrary);
          this.crosshair.setScale(crosshairSize);
          this.crosshair.setVisibility(displayCrosshair);
          this.arbitraryView.resizeThrottled();
        },
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
    this.storePropertyUnsubscribers.forEach((unsubscribe) => unsubscribe());
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
      this.setParticleSize(Utils.clamp(-1, delta, 1));
    }
  };

  destroyInput() {
    this.input.mouseController?.destroy();
    this.input.keyboard?.destroy();
    this.input.keyboardLoopDelayed?.destroy();
    this.input.keyboardNoLoop?.destroy();
  }

  handleCreateNode(): void {
    if (!Store.getState().temporaryConfiguration.flightmodeRecording) {
      return;
    }
    const state = Store.getState();
    const position = getPosition(state.flycam);
    const rotation = getRotation(state.flycam);
    const additionalCoordinates = state.flycam.additionalCoordinates;
    Store.dispatch(
      createNodeAction(
        untransformNodePosition(position, state),
        additionalCoordinates,
        rotation,
        constants.ARBITRARY_VIEW,
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
