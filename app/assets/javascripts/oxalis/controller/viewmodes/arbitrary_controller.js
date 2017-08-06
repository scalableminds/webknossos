/**
 * arbitrary_controller.js
 * @flow
 */

import React from "react";
import Backbone from "backbone";
import _ from "lodash";
import TWEEN from "tween.js";
import { InputKeyboard, InputMouse, InputKeyboardNoLoop } from "libs/input";
import type { ModifierKeys } from "libs/input";
import { V3 } from "libs/mjs";
import Utils from "libs/utils";
import Toast from "libs/toast";
import type { ModeType, Vector3, Point2 } from "oxalis/constants";
import Store from "oxalis/store";
import Model from "oxalis/model";
import {
  updateUserSettingAction,
  setFlightmodeRecordingAction,
  setViewModeAction,
} from "oxalis/model/actions/settings_actions";
import {
  setActiveNodeAction,
  deleteNodeAction,
  createTreeAction,
  createNodeAction,
  createBranchPointAction,
  requestDeleteBranchPointAction,
  toggleAllTreesAction,
  toggleInactiveTreesAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import ArbitraryPlane from "oxalis/geometries/arbitrary_plane";
import Crosshair from "oxalis/geometries/crosshair";
import ArbitraryView from "oxalis/view/arbitrary_view";
import constants from "oxalis/constants";
import type { Matrix4x4 } from "libs/mjs";
import {
  yawFlycamAction,
  pitchFlycamAction,
  setPositionAction,
  setRotationAction,
  zoomInAction,
  zoomOutAction,
  moveFlycamAction,
} from "oxalis/model/actions/flycam_actions";
import { getRotation, getPosition } from "oxalis/model/accessors/flycam_accessor";
import { getActiveNode, getMaxNodeId } from "oxalis/model/accessors/skeletontracing_accessor";
import messages from "messages";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import SceneController from "oxalis/controller/scene_controller";

const CANVAS_SELECTOR = "#render-canvas";
const TIMETOCENTER = 200;

type Props = {
  onRender: () => void,
  viewMode: ModeType,
};

class ArbitraryController extends React.PureComponent {
  // See comment in Controller class on general controller architecture.
  //
  // Arbitrary Controller: Responsible for Arbitrary Modes
  arbitraryView: ArbitraryView;
  isStarted: boolean;
  plane: ArbitraryPlane;
  crosshair: Crosshair;
  lastNodeMatrix: Matrix4x4;
  input: {
    mouse?: InputMouse,
    keyboard?: InputKeyboard,
    keyboardNoLoop?: InputKeyboardNoLoop,
    keyboardOnce?: InputKeyboard,
  };
  props: Props;
  storePropertyUnsubscribers: Array<Function>;

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;
  stopListening: Function;

  componentDidMount() {
    _.extend(this, Backbone.Events);
    this.input = {};
    this.storePropertyUnsubscribers = [];
    this.start();
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.viewMode !== this.props.viewMode) {
      this.plane.setMode(this.props.viewMode);
    }
  }

  componentWillUnmount() {
    this.stop();
  }

  pingBinaries(): void {
    const matrix = Store.getState().flycam.currentMatrix;
    Model.getColorBinaries().forEach(binary =>
      binary.arbitraryPing(matrix, Store.getState().datasetConfiguration.quality),
    );
  }

  initMouse(): void {
    this.input.mouse = new InputMouse(CANVAS_SELECTOR, {
      leftDownMove: (delta: Point2) => {
        const mouseInversionX = Store.getState().userConfiguration.inverseX ? 1 : -1;
        const mouseInversionY = Store.getState().userConfiguration.inverseY ? 1 : -1;
        if (this.props.viewMode === constants.MODE_ARBITRARY) {
          Store.dispatch(
            yawFlycamAction(
              -delta.x * mouseInversionX * Store.getState().userConfiguration.mouseRotateValue,
              true,
            ),
          );
          Store.dispatch(
            pitchFlycamAction(
              delta.y * mouseInversionY * Store.getState().userConfiguration.mouseRotateValue,
              true,
            ),
          );
        } else if (this.props.viewMode === constants.MODE_ARBITRARY_PLANE) {
          const f =
            Store.getState().flycam.zoomStep /
            (this.arbitraryView.width / constants.ARBITRARY_WIDTH);
          Store.dispatch(moveFlycamAction([delta.x * f, delta.y * f, 0]));
        }
      },
      rightClick: (pos: Point2) => {
        this.createBranchMarker(pos);
      },
      scroll: this.scroll,
    });
  }

  initKeyboard(): void {
    const getRotateValue = () => Store.getState().userConfiguration.rotateValue;
    const isArbitrary = () => this.props.viewMode === constants.MODE_ARBITRARY;

    this.input.keyboard = new InputKeyboard({
      // KeyboardJS is sensitive to ordering (complex combos first)

      // Scale plane
      l: () => this.arbitraryView.applyScale(-Store.getState().userConfiguration.scaleValue),
      k: () => this.arbitraryView.applyScale(Store.getState().userConfiguration.scaleValue),

      // Move
      space: timeFactor => {
        this.setRecord(true);
        this.move(timeFactor);
      },
      "ctrl + space": timeFactor => {
        this.setRecord(true);
        this.move(-timeFactor);
      },

      f: timeFactor => {
        this.setRecord(false);
        this.move(timeFactor);
      },
      d: timeFactor => {
        this.setRecord(false);
        this.move(-timeFactor);
      },

      // Rotate at centre
      "shift + left": timeFactor => {
        Store.dispatch(yawFlycamAction(getRotateValue() * timeFactor));
      },
      "shift + right": timeFactor => {
        Store.dispatch(yawFlycamAction(-getRotateValue() * timeFactor));
      },
      "shift + up": timeFactor => {
        Store.dispatch(pitchFlycamAction(getRotateValue() * timeFactor));
      },
      "shift + down": timeFactor => {
        Store.dispatch(pitchFlycamAction(-getRotateValue() * timeFactor));
      },

      // Rotate in distance
      left: timeFactor => {
        Store.dispatch(yawFlycamAction(getRotateValue() * timeFactor, isArbitrary()));
      },
      right: timeFactor => {
        Store.dispatch(yawFlycamAction(-getRotateValue() * timeFactor, isArbitrary()));
      },
      up: timeFactor => {
        Store.dispatch(pitchFlycamAction(-getRotateValue() * timeFactor, isArbitrary()));
      },
      down: timeFactor => {
        Store.dispatch(pitchFlycamAction(getRotateValue() * timeFactor, isArbitrary()));
      },

      // Zoom in/out
      i: () => {
        Store.dispatch(zoomInAction());
      },
      o: () => {
        Store.dispatch(zoomOutAction());
      },

      // Change move value
      h: () => this.changeMoveValue(25),
      g: () => this.changeMoveValue(-25),
    });

    this.input.keyboardNoLoop = new InputKeyboardNoLoop({
      "1": () => {
        Store.dispatch(toggleAllTreesAction());
      },
      "2": () => {
        Store.dispatch(toggleInactiveTreesAction());
      },

      // Branches
      b: () => this.pushBranch(),
      j: () => {
        Store.dispatch(requestDeleteBranchPointAction());
      },

      // Recenter active node
      s: () => this.centerActiveNode(),

      ".": () => this.nextNode(true),
      ",": () => this.nextNode(false),

      // Rotate view by 180 deg
      r: () => {
        Store.dispatch(yawFlycamAction(Math.PI));
      },
    });

    this.input.keyboardOnce = new InputKeyboard(
      // Delete active node and recenter last node
      {
        "shift + space": () => {
          Store.dispatch(deleteNodeAction());
        },
      },
      -1,
    );
  }

  setRecord(record: boolean): void {
    if (record !== Store.getState().temporaryConfiguration.flightmodeRecording) {
      Store.dispatch(setFlightmodeRecordingAction(record));
      this.setWaypoint();
    }
  }

  createBranchMarker(pos: Point2): void {
    Store.dispatch(setViewModeAction(constants.MODE_ARBITRARY_PLANE));
    const f =
      Store.getState().flycam.zoomStep / (this.arbitraryView.width / constants.ARBITRARY_WIDTH);
    Store.dispatch(
      moveFlycamAction([
        -(pos.x - this.arbitraryView.width / 2) * f,
        -(pos.y - this.arbitraryView.width / 2) * f,
        0,
      ]),
    );
    Store.dispatch(createTreeAction());
    this.setWaypoint();
    Store.dispatch(
      moveFlycamAction([
        (pos.x - this.arbitraryView.width / 2) * f,
        (pos.y - this.arbitraryView.width / 2) * f,
        0,
      ]),
    );
    Store.dispatch(setViewModeAction(constants.MODE_ARBITRARY));
    this.moved();
  }

  nextNode(nextOne: boolean): void {
    Utils.zipMaybe(
      getActiveNode(Store.getState().tracing),
      getMaxNodeId(Store.getState().tracing),
    ).map(([activeNode, maxNodeId]) => {
      if ((nextOne && activeNode.id === maxNodeId) || (!nextOne && activeNode.id === 1)) {
        return;
      }
      Store.dispatch(setActiveNodeAction(activeNode.id + 2 * Number(nextOne) - 1)); // implicit cast from boolean to int
    });
  }

  getVoxelOffset(timeFactor: number): number {
    const state = Store.getState();
    const moveValue3d = state.userConfiguration.moveValue3d;
    const baseVoxel = getBaseVoxel(state.dataset.scale);
    return moveValue3d * timeFactor / baseVoxel / constants.FPS;
  }

  move(timeFactor: number): void {
    if (!this.isStarted) {
      return;
    }
    Store.dispatch(moveFlycamAction([0, 0, this.getVoxelOffset(timeFactor)]));
    this.moved();
  }

  init(): void {
    const clippingDistanceArbitrary = Store.getState().userConfiguration.clippingDistanceArbitrary;
    this.setClippingDistance(clippingDistanceArbitrary);
    this.arbitraryView.applyScale(0);
  }

  bindToEvents(): void {
    this.listenTo(this.arbitraryView, "render", this.pingBinaries);
    this.listenTo(this.arbitraryView, "render", this.props.onRender);

    for (const name of Object.keys(Model.binary)) {
      const binary = Model.binary[name];
      this.listenTo(binary.cube, "bucketLoaded", this.arbitraryView.draw);
    }

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        state => state.userConfiguration,
        userConfiguration => {
          const {
            sphericalCapRadius,
            clippingDistanceArbitrary,
            displayCrosshair,
          } = userConfiguration;
          this.crosshair.setScale(sphericalCapRadius);
          this.setClippingDistance(clippingDistanceArbitrary);
          this.crosshair.setVisibility(displayCrosshair);
        },
      ),
      listenToStoreProperty(
        state => state.temporaryConfiguration.flightmodeRecording,
        isRecording => {
          if (isRecording) {
            // This listener is responsible for setting a new waypoint, when the user enables
            // the "flightmode recording" toggle in the top-left corner of the flight canvas.
            this.setWaypoint();
          }
        },
      ),
    );
  }

  start(): void {
    this.arbitraryView = new ArbitraryView(CANVAS_SELECTOR, constants.ARBITRARY_WIDTH);
    this.arbitraryView.start();

    this.plane = new ArbitraryPlane(constants.ARBITRARY_WIDTH);
    this.plane.setMode(this.props.viewMode);
    this.crosshair = new Crosshair(Store.getState().userConfiguration.crosshairSize);
    this.crosshair.setVisibility(Store.getState().userConfiguration.displayCrosshair);

    this.arbitraryView.addGeometry(this.plane);
    this.arbitraryView.addGeometry(this.crosshair);

    this.bindToEvents();

    this.initKeyboard();
    this.initMouse();
    this.init();

    const clippingDistance = Store.getState().userConfiguration.clippingDistance;
    SceneController.setClippingDistance(clippingDistance);

    this.arbitraryView.draw();

    this.isStarted = true;
  }

  unsubscribeStoreListeners() {
    this.storePropertyUnsubscribers.forEach(unsubscribe => unsubscribe());
    this.storePropertyUnsubscribers = [];
  }

  stop(): void {
    this.stopListening();
    this.unsubscribeStoreListeners();

    if (this.isStarted) {
      this.destroyInput();
    }

    this.arbitraryView.stop();

    this.isStarted = false;
  }

  scroll = (delta: number, type: ?ModifierKeys) => {
    if (type === "shift") {
      this.setParticleSize(Utils.clamp(-1, delta, 1));
    }
  };

  destroyInput() {
    Utils.__guard__(this.input.mouse, x => x.destroy());
    Utils.__guard__(this.input.keyboard, x => x.destroy());
    Utils.__guard__(this.input.keyboardNoLoop, x => x.destroy());
    Utils.__guard__(this.input.keyboardOnce, x => x.destroy());
  }

  setWaypoint(): void {
    if (!Store.getState().temporaryConfiguration.flightmodeRecording) {
      return;
    }
    const position = getPosition(Store.getState().flycam);
    const rotation = getRotation(Store.getState().flycam);

    Store.dispatch(createNodeAction(position, rotation, constants.ARBITRARY_VIEW, 0));
  }

  changeMoveValue(delta: number): void {
    let moveValue = Store.getState().userConfiguration.moveValue3d + delta;
    moveValue = Math.min(constants.MAX_MOVE_VALUE, moveValue);
    moveValue = Math.max(constants.MIN_MOVE_VALUE, moveValue);

    Store.dispatch(updateUserSettingAction("moveValue3d", moveValue));
  }

  setParticleSize(delta: number): void {
    let particleSize = Store.getState().userConfiguration.particleSize + delta;
    particleSize = Math.min(constants.MAX_PARTICLE_SIZE, particleSize);
    particleSize = Math.max(constants.MIN_PARTICLE_SIZE, particleSize);

    Store.dispatch(updateUserSettingAction("particleSize", particleSize));
  }

  setClippingDistance(value: number): void {
    this.arbitraryView.setClippingDistance(value);
  }

  pushBranch(): void {
    // Consider for deletion
    this.setWaypoint();
    Store.dispatch(createBranchPointAction());
    Toast.success(messages["tracing.branchpoint_set"]);
  }

  centerActiveNode(): void {
    getActiveNode(Store.getState().tracing).map(activeNode => {
      // animate the change to the new position and new rotation
      const curPos = getPosition(Store.getState().flycam);
      const newPos = activeNode.position;
      const curRotation = getRotation(Store.getState().flycam);
      let newRotation = activeNode.rotation;
      newRotation = this.getShortestRotation(curRotation, newRotation);

      const waypointAnimation = new TWEEN.Tween({
        x: curPos[0],
        y: curPos[1],
        z: curPos[2],
        rx: curRotation[0],
        ry: curRotation[1],
        rz: curRotation[2],
      });
      waypointAnimation.to(
        {
          x: newPos[0],
          y: newPos[1],
          z: newPos[2],
          rx: newRotation[0],
          ry: newRotation[1],
          rz: newRotation[2],
        },
        TIMETOCENTER,
      );
      waypointAnimation.onUpdate(function() {
        Store.dispatch(setPositionAction([this.x, this.y, this.z]));
        Store.dispatch(setRotationAction([this.rx, this.ry, this.rz]));
      });
      waypointAnimation.start();
    });
  }

  getShortestRotation(curRotation: Vector3, newRotation: Vector3): Vector3 {
    // TODO
    // interpolating Euler angles does not lead to the shortest rotation
    // interpolate the Quaternion representation instead
    // https://theory.org/software/qfa/writeup/node12.html

    const result = [newRotation[0], newRotation[1], newRotation[2]];
    for (let i = 0; i <= 2; i++) {
      // a rotation about more than 180° is shorter when rotating the other direction
      if (newRotation[i] - curRotation[i] > 180) {
        result[i] = newRotation[i] - 360;
      } else if (newRotation[i] - curRotation[i] < -180) {
        result[i] = newRotation[i] + 360;
      }
    }
    return result;
  }

  moved(): void {
    const matrix = Store.getState().flycam.currentMatrix;

    if (this.lastNodeMatrix == null) {
      this.lastNodeMatrix = matrix;
    }

    const { lastNodeMatrix } = this;

    const vector = [
      lastNodeMatrix[12] - matrix[12],
      lastNodeMatrix[13] - matrix[13],
      lastNodeMatrix[14] - matrix[14],
    ];
    const vectorLength = V3.length(vector);

    if (vectorLength > 10) {
      this.setWaypoint();
      this.lastNodeMatrix = matrix;
    }
  }

  render() {
    return null;
  }
}

export default ArbitraryController;
