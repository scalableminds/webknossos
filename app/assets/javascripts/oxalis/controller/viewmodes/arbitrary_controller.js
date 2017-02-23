/**
 * arbitrary_controller.js
 * @flow
 */

import Backbone from "backbone";
import $ from "jquery";
import _ from "lodash";
import TWEEN from "tween.js";
import { InputKeyboard, InputMouse, InputKeyboardNoLoop } from "libs/input";
import type { ModifierKeys } from "libs/input";
import { V3 } from "libs/mjs";
import Utils from "libs/utils";
import Toast from "libs/toast";
import type { ModeType, Vector3, Point2 } from "oxalis/constants";
import Model from "oxalis/model";
import View from "oxalis/view";
import Store from "oxalis/store";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { setActiveNodeAction, setCommentForNodeAction, deleteNodeAction, createTreeAction, createNodeAction, createBranchPointAction, deleteBranchPointAction } from "oxalis/model/actions/skeletontracing_actions";
import SceneController from "oxalis/controller/scene_controller";
import SkeletonTracingController from "oxalis/controller/annotations/skeletontracing_controller";
import Flycam3d from "oxalis/model/flycam3d";
import scaleInfo from "oxalis/model/scaleinfo";
import ArbitraryPlane from "oxalis/geometries/arbitrary_plane";
import Crosshair from "oxalis/geometries/crosshair";
import ArbitraryView from "oxalis/view/arbitrary_view";
import ArbitraryPlaneInfo from "oxalis/geometries/arbitrary_plane_info";
import constants from "oxalis/constants";
import type { Matrix4x4 } from "libs/mjs";

class ArbitraryController {
  arbitraryView: ArbitraryView;
  model: Model;
  view: View;
  sceneController: SceneController;
  skeletonTracingController: SkeletonTracingController;
  isStarted: boolean;
  canvas: JQuery;
  cam: Flycam3d;
  plane: ArbitraryPlane;
  infoPlane: ArbitraryPlaneInfo;
  crosshair: Crosshair;
  WIDTH: number;
  TIMETOCENTER: number;
  fullscreen: boolean;
  lastNodeMatrix: Matrix4x4;
  input: {
    mouse: ?InputMouse;
    keyboard: ?InputKeyboard;
    keyboardNoLoop: ?InputKeyboardNoLoop;
    keyboardOnce: ?InputKeyboard;
    destroy: () => void;
  };
  mode: ModeType = 0;

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;

  static initClass() {
    // See comment in Controller class on general controller architecture.
    //
    // Arbitrary Controller: Responsible for Arbitrary Modes

    this.prototype.WIDTH = 128;
    this.prototype.TIMETOCENTER = 200;
    this.prototype.fullscreen = false;

    this.prototype.input = {
      mouse: null,
      keyboard: null,
      keyboardNoLoop: null,
      keyboardOnce: null,

      destroy() {
        Utils.__guard__(this.mouse, x => x.destroy());
        Utils.__guard__(this.keyboard, x1 => x1.destroy());
        Utils.__guard__(this.keyboardNoLoop, x2 => x2.destroy());
        Utils.__guard__(this.keyboardOnce, x3 => x3.destroy());
      },
    };
  }

  constructor(
    model: Model,
    view: View,
    sceneController: SceneController,
    skeletonTracingController: SkeletonTracingController,
  ) {
    let canvas;
    this.model = model;
    this.view = view;
    this.sceneController = sceneController;
    this.skeletonTracingController = skeletonTracingController;
    _.extend(this, Backbone.Events);

    this.isStarted = false;

    this.canvas = canvas = $("#render-canvas");

    this.cam = this.model.flycam3d;
    this.arbitraryView = new ArbitraryView(canvas, this.cam, this.view, this.WIDTH);

    this.plane = new ArbitraryPlane(this.cam, this.model, this, this.WIDTH);
    this.arbitraryView.addGeometry(this.plane);

    // render HTML element to indicate recording status
    this.infoPlane = new ArbitraryPlaneInfo({ model: this.model });
    this.infoPlane.render();
    $("#render").append(this.infoPlane.el);


    this.input = _.extend({}, this.input);

    this.crosshair = new Crosshair(this.cam, Store.getState().userConfiguration.crosshairSize);
    this.arbitraryView.addGeometry(this.crosshair);

    this.bindToEvents();
    this.arbitraryView.draw();

    this.stop();

    this.crosshair.setVisibility(Store.getState().userConfiguration.displayCrosshair);
  }


  render(): void {
    const matrix = this.cam.getMatrix();
    this.model.getColorBinaries().forEach(binary =>
      binary.arbitraryPing(matrix, Store.getState().datasetConfiguration.quality));
  }


  initMouse(): void {
    this.input.mouse = new InputMouse(
      this.canvas, {
        leftDownMove: (delta: Point2) => {
          const mouseInversionX = Store.getState().userConfiguration.inverseX ? 1 : -1;
          const mouseInversionY = Store.getState().userConfiguration.inverseY ? 1 : -1;
          if (this.mode === constants.MODE_ARBITRARY) {
            this.cam.yaw(
              -delta.x * mouseInversionX * Store.getState().userConfiguration.mouseRotateValue,
              true,
            );
            this.cam.pitch(
              delta.y * mouseInversionY * Store.getState().userConfiguration.mouseRotateValue,
              true,
            );
          } else if (this.mode === constants.MODE_ARBITRARY_PLANE) {
            const f = this.cam.getZoomStep() / (this.arbitraryView.width / this.WIDTH);
            this.cam.move([delta.x * f, delta.y * f, 0]);
          }
        },
        rightClick: (pos: Point2) => { this.createBranchMarker(pos); },
        scroll: this.scroll,
      },
    );
  }


  initKeyboard(): void {
    this.input.keyboard = new InputKeyboard({

      // KeyboardJS is sensitive to ordering (complex combos first)

      // Scale plane
      l: () => this.arbitraryView.applyScale(-Store.getState().userConfiguration.scaleValue),
      k: () => this.arbitraryView.applyScale(Store.getState().userConfiguration.scaleValue),

      // Move
      space: (timeFactor) => {
        this.setRecord(true);
        this.move(timeFactor);
      },
      "ctrl + space": (timeFactor) => {
        this.setRecord(true);
        this.move(-timeFactor);
      },

      f: (timeFactor) => {
        this.setRecord(false);
        this.move(timeFactor);
      },
      d: (timeFactor) => {
        this.setRecord(false);
        this.move(-timeFactor);
      },

      // Rotate at centre
      "shift + left": timeFactor => this.cam.yaw(Store.getState().userConfiguration.rotateValue * timeFactor),
      "shift + right": timeFactor => this.cam.yaw(-Store.getState().userConfiguration.rotateValue * timeFactor),
      "shift + up": timeFactor => this.cam.pitch(Store.getState().userConfiguration.rotateValue * timeFactor),
      "shift + down": timeFactor => this.cam.pitch(-Store.getState().userConfiguration.rotateValue * timeFactor),

      // Rotate in distance
      left: timeFactor => this.cam.yaw(Store.getState().userConfiguration.rotateValue * timeFactor, this.mode === constants.MODE_ARBITRARY),
      right: timeFactor => this.cam.yaw(-Store.getState().userConfiguration.rotateValue * timeFactor, this.mode === constants.MODE_ARBITRARY),
      up: timeFactor => this.cam.pitch(-Store.getState().userConfiguration.rotateValue * timeFactor, this.mode === constants.MODE_ARBITRARY),
      down: timeFactor => this.cam.pitch(Store.getState().userConfiguration.rotateValue * timeFactor, this.mode === constants.MODE_ARBITRARY),

      // Zoom in/out
      i: () => this.cam.zoomIn(),
      o: () => this.cam.zoomOut(),

      // Change move value
      h: () => this.changeMoveValue(25),
      g: () => this.changeMoveValue(-25),
    });

    this.input.keyboardNoLoop = new InputKeyboardNoLoop({

      // Branches
      b: () => this.pushBranch(),
      j: () => this.popBranch(),

      // Recenter active node
      s: () => this.centerActiveNode(),

      ".": () => this.nextNode(true),
      ",": () => this.nextNode(false),

      // Rotate view by 180 deg
      r: () => this.cam.yaw(Math.PI),
    });

    this.input.keyboardOnce = new InputKeyboard(

      // Delete active node and recenter last node
      { "shift + space": () => Store.dispatch(deleteNodeAction()) }
    , -1);
  }


  setRecord(record: boolean): void {
    if (record !== this.model.get("flightmodeRecording")) {
      this.model.set("flightmodeRecording", record);
      this.setWaypoint();
    }
  }


  createBranchMarker(pos: Point2): void {
    if (!this.isBranchpointvideoMode() && !this.isSynapseannotationMode()) { return; }
    const activeNode = Store.getState().skeletonTracing.getActiveNode();
    this.model.setMode(2);
    const f = this.cam.getZoomStep() / (this.arbitraryView.width / this.WIDTH);
    this.cam.move([-(pos.x - (this.arbitraryView.width / 2)) * f, -(pos.y - (this.arbitraryView.width / 2)) * f, 0]);
    Store.dispatch(createTreeAction());
    this.setWaypoint();
    this.cam.move([(pos.x - (this.arbitraryView.width / 2)) * f, (pos.y - (this.arbitraryView.width / 2)) * f, 0]);
    if (this.isBranchpointvideoMode()) {
      Store.dispatch(setActiveNodeAction(activeNode.id, true));
    }
    this.model.setMode(1);
    this.moved();
  }


  nextNode(nextOne: boolean): void {
    if (!this.isBranchpointvideoMode()) { return; }
    const activeNode = Store.getState().skeletonTracing.getActiveNode();
    if ((nextOne && activeNode.id === Store.getState().skeletonTracing.getActiveTree().nodes.length) || (!nextOne && activeNode.id === 1)) {
      return;
    }
    Store.dispatch(setActiveNodeAction((activeNode.id + (2 * Number(nextOne))) - 1), true);// implicit cast from boolean to int
    if ((this.view.theme === constants.THEME_BRIGHT) !== nextOne) { // switch background to black for backwards move
      this.view.toggleTheme();
    }
  }

  getVoxelOffset(timeFactor: number): number {
    const moveValue3d = Store.getState().userConfiguration.moveValue3d;
    return (moveValue3d * timeFactor) / scaleInfo.baseVoxel / constants.FPS;
  }

  move(timeFactor: number): void {
    if (!this.isStarted) { return; }
    if (this.isBranchpointvideoMode()) { return; }
    this.cam.move([0, 0, this.getVoxelOffset(timeFactor)]);
    this.moved();
  }

  init(): void {
    const clippingDistanceArbitrary = Store.getState().userConfiguration.clippingDistanceArbitrary;
    this.setClippingDistance(clippingDistanceArbitrary);
    this.arbitraryView.applyScale(0);
  }


  bindToEvents(): void {
    this.listenTo(this.arbitraryView, "render", this.render);

    for (const name of Object.keys(this.model.binary)) {
      const binary = this.model.binary[name];
      this.listenTo(binary.cube, "bucketLoaded", this.arbitraryView.draw);
    }

    Store.subscribe(() => {
      const { sphericalCapRadius, clippingDistanceArbitrary, displayCrosshair } = Store.getState().userConfiguration;
      this.crosshair.setScale(sphericalCapRadius);
      this.model.flycam3d.distance = sphericalCapRadius;
      this.plane.setMode(this.mode);
      this.setClippingDistance(clippingDistanceArbitrary);
      this.crosshair.setVisibility(displayCrosshair);
    });
  }


  start(mode: ModeType): void {
    this.mode = mode;
    this.stop();

    this.plane.setMode(this.mode);

    this.initKeyboard();
    this.initMouse();
    this.arbitraryView.start();
    this.init();
    this.arbitraryView.draw();

    this.isStarted = true;
  }


  stop(): void {
    if (this.isStarted) {
      this.input.destroy();
    }

    this.arbitraryView.stop();

    this.isStarted = false;
  }

  scroll = (delta: number, type: ?ModifierKeys) => {
    if (type === "shift") {
      this.setParticleSize(Utils.clamp(-1, delta, 1));
    }
  }

  setWaypoint(): void {
    if (!this.model.get("flightmodeRecording")) {
      return;
    }

    const position = this.cam.getPosition();
    const rotation = this.cam.getRotation();

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
    if (this.isBranchpointvideoMode()) {
      this.arbitraryView.setClippingDistance(constants.BRANCHPOINT_VIDEO_CLIPPING_DISTANCE);
    }
    this.arbitraryView.setClippingDistance(value);
  }


  pushBranch(): void {
    // Consider for deletion
    this.setWaypoint();
    Store.dispatch(createBranchPointAction());
    Toast.success("Branchpoint set");
  }


  popBranch(): void {
    // Consider for deletion
    Store.dispatch(deleteBranchPointAction());

    const activeNodeId = Store.getState().skeletonTracing.getActiveNodeId();
    if (activeNodeId === 1) {
      this.cam.yaw(Math.PI);
      Toast.warning("Reached initial node, view reversed");
      Store.dispatch(setCommentForNodeAction(activeNodeId, "reversed"));
    }
  }


  centerActiveNode(): void {
    const activeNode = Store.getState().skeletonTracing.getActiveNode();
    if (activeNode) {
      // animate the change to the new position and new rotation
      const curPos = this.cam.getPosition();
      const newPos = Store.getState().skeletonTracing.getActiveNodePos();
      const curRotation = this.cam.getRotation();
      let newRotation = Store.getState().skeletonTracing.getActiveNodeRotation();
      newRotation = this.getShortestRotation(curRotation, newRotation);

      const waypointAnimation = new TWEEN.Tween({
        x: curPos[0],
        y: curPos[1],
        z: curPos[2],
        rx: curRotation[0],
        ry: curRotation[1],
        rz: curRotation[2],
        cam: this.cam,
      });
      waypointAnimation.to({
        x: newPos[0],
        y: newPos[1],
        z: newPos[2],
        rx: newRotation[0],
        ry: newRotation[1],
        rz: newRotation[2],
      }, this.TIMETOCENTER);
      waypointAnimation.onUpdate(function () {
        this.cam.setPosition([this.x, this.y, this.z]);
        this.cam.setRotation([this.rx, this.ry, this.rz]);
      });
      waypointAnimation.start();

      this.cam.update();
    }
  }


  setActiveNode(nodeId: number, centered: boolean, mergeTree: boolean = false): void {
    // Consider for removal
    Store.dispatch(setActiveNodeAction(nodeId, mergeTree));

    this.cam.setPosition(Store.getState().skeletonTracing.getActiveNodePos());
    this.cam.setRotation(Store.getState().skeletonTracing.getActiveNodeRotation());
  }

  getShortestRotation(curRotation: Vector3, newRotation: Vector3): Vector3 {
    // TODO
    // interpolating Euler angles does not lead to the shortest rotation
    // interpolate the Quaternion representation instead
    // https://theory.org/software/qfa/writeup/node12.html

    for (let i = 0; i <= 2; i++) {
      // a rotation about more than 180° is shorter when rotating the other direction
      if (newRotation[i] - curRotation[i] > 180) {
        newRotation[i] -= 360;
      } else if (newRotation[i] - curRotation[i] < -180) {
        newRotation[i] += 360;
      }
    }
    return newRotation;
  }


  moved(): void {
    const matrix = this.cam.getMatrix();

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


  isBranchpointvideoMode(): boolean {
    return Utils.__guard__(this.model.tracing.task, x => x.type.summary) === "branchpointvideo";
  }


  isSynapseannotationMode(): boolean {
    return Utils.__guard__(this.model.tracing.task, x => x.type.summary) === "synapseannotation";
  }
}
ArbitraryController.initClass();


export default ArbitraryController;
