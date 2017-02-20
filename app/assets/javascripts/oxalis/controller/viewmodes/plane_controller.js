/**
 * plane_controller.js
 * @flow
 */

import app from "app";
import Backbone from "backbone";
import $ from "jquery";
import _ from "lodash";
import Utils from "libs/utils";
import { InputMouse, InputKeyboard, InputKeyboardNoLoop } from "libs/input";
import * as THREE from "three";
import TrackballControls from "libs/trackball_controls";
import Model from "oxalis/model";
import View from "oxalis/view";
import SceneController from "oxalis/controller/scene_controller";
import Flycam2d from "oxalis/model/flycam2d";
import scaleInfo from "oxalis/model/scaleinfo";
import CameraController from "oxalis/controller/camera_controller";
import Dimensions from "oxalis/model/dimensions";
import PlaneView from "oxalis/view/plane_view";
import constants, { OrthoViews, OrthoViewValues, OrthoViewValuesWithoutTDView } from "oxalis/constants";
import type { Point2, Vector3, OrthoViewType, OrthoViewMapType } from "oxalis/constants";
import type { ModifierKeys } from "libs/input";

class PlaneController {
  planeView: PlaneView;
  model: Model;
  view: View;
  input: {
    mouseControllers: OrthoViewMapType<InputMouse>;
    keyboard: ?InputKeyboard;
    keyboardNoLoop: ?InputKeyboardNoLoop;
    keyboardLoopDelayed: ?InputKeyboard;
    destroy(): void;
  };
  sceneController: SceneController;
  isStarted: boolean;
  flycam: Flycam2d;
  oldNmPos: Vector3;
  planeView: PlaneView;
  activeViewport: OrthoViewType;
  cameraController: CameraController;
  zoomPos: Vector3;
  controls: TrackballControls;
  canvasesAndNav: any;
  TDViewControls: any;
  bindings: Array<any>;
  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;

  static initClass() {
    // See comment in Controller class on general controller architecture.
    //
    // Plane Controller: Responsible for Plane Modes

    this.prototype.bindings = [];

    this.prototype.input = {
      mouseControllers: {},
      keyboard: null,
      keyboardNoLoop: null,
      keyboardLoopDelayed: null,

      destroy() {
        for (const mouse of _.values(this.mouseControllers)) {
          mouse.destroy();
        }
        this.mouseControllers = {};
        Utils.__guard__(this.keyboard, x => x.destroy());
        Utils.__guard__(this.keyboardNoLoop, x1 => x1.destroy());
        Utils.__guard__(this.keyboardLoopDelayed, x2 => x2.destroy());
      },
    };
  }


  constructor(
    model: Model,
    view: View,
    sceneController: SceneController,
  ) {
    _.extend(this, Backbone.Events);
    this.model = model;
    this.view = view;
    this.sceneController = sceneController;

    this.isStarted = false;

    this.flycam = this.model.flycam;

    this.oldNmPos = scaleInfo.voxelToNm(this.flycam.getPosition());

    this.planeView = new PlaneView(this.model, this.view);

    this.activeViewport = OrthoViews.PLANE_XY;

    // initialize Camera Controller
    this.cameraController = new CameraController(this.planeView.getCameras(), this.flycam, this.model);

    this.canvasesAndNav = $("#main")[0];

    this.TDViewControls = $("#TDViewControls");
    this.TDViewControls.addClass("btn-group");

    const callbacks = [
      this.cameraController.changeTDViewDiagonal,
      this.cameraController.changeTDViewXY,
      this.cameraController.changeTDViewYZ,
      this.cameraController.changeTDViewXZ,
    ];
    $("#TDViewControls button")
      .each((i, element) => $(element).on("click", () => { callbacks[i](); }));

    const meshes = this.sceneController.getMeshes();

    for (const mesh of meshes) {
      this.planeView.addGeometry(mesh);
    }

    this.model.user.triggerAll();
    this.model.datasetConfiguration.triggerAll();

    this.initTrackballControls();
    this.bindToEvents();
    this.stop();
  }


  initMouse(): void {
    for (const id of OrthoViewValues) {
      if (id !== OrthoViews.TDView) {
        const inputcatcher = $(`#inputcatcher_${OrthoViews[id]}`);
        this.input.mouseControllers[id] =
          new InputMouse(inputcatcher, this.getPlaneMouseControls(id), id);
      } else {
        this.input.mouseControllers[id] =
          new InputMouse($("#inputcatcher_TDView"), this.getTDViewMouseControls(), id);
      }
    }
  }


  getTDViewMouseControls(): Object {
    return {
      leftDownMove: (delta: Point2) => this.moveTDView(delta),
      scroll: (value: number) => this.zoomTDView(Utils.clamp(-1, value, 1), true),
      over: () => this.planeView.setActiveViewport(this.activeViewport = OrthoViews.TDView),
    };
  }


  getPlaneMouseControls(planeId: OrthoViewType): Object {
    return {
      leftDownMove: (delta: Point2) => this.move([
        (delta.x * this.model.user.getMouseInversionX()) / this.planeView.scaleFactor,
        (delta.y * this.model.user.getMouseInversionY()) / this.planeView.scaleFactor,
        0,
      ]),

      over: () => {
        $(":focus").blur();
        this.planeView.setActiveViewport(this.activeViewport = planeId);
      },

      scroll: this.scrollPlanes.bind(this),
    };
  }


  initTrackballControls(): void {
    const view = $("#inputcatcher_TDView")[0];
    const pos = scaleInfo.voxelToNm(this.flycam.getPosition());
    this.controls = new TrackballControls(
      this.planeView.getCameras()[OrthoViews.TDView],
      view,
      new THREE.Vector3(...pos),
      () => app.vent.trigger("rerender"));

    this.controls.noZoom = true;
    this.controls.noPan = true;
    this.controls.staticMoving = true;

    this.controls.target.set(
      ...scaleInfo.voxelToNm(this.flycam.getPosition()));

    this.listenTo(this.flycam, "positionChanged", (position) => {
      const nmPosition = scaleInfo.voxelToNm(position);

      this.controls.target.set(...nmPosition);
      this.controls.update();

      // As the previous step will also move the camera, we need to
      // fix this by offsetting the viewport

      const invertedDiff = [];
      for (let i = 0; i <= 2; i++) {
        invertedDiff.push(this.oldNmPos[i] - nmPosition[i]);
      }
      this.oldNmPos = nmPosition;

      return this.cameraController.moveTDView(
        new THREE.Vector3(...invertedDiff),
      );
    });

    this.listenTo(this.cameraController, "cameraPositionChanged", this.controls.update);
  }


  initKeyboard(): void {
    // avoid scrolling while pressing space
    $(document).keydown((event) => {
      if ((event.which === 32 || event.which === 18 || event.which >= 37 && event.which <= 40) && !$(":focus").length) {
        event.preventDefault();
      }
    });

    const getMoveValue = (timeFactor) => {
      if (([0, 1, 2]).includes(this.activeViewport)) {
        return (this.model.user.get("moveValue") * timeFactor) / scaleInfo.baseVoxel / constants.FPS;
      }
      return (constants.TDView_MOVE_SPEED * timeFactor) / constants.FPS;
    };

    this.input.keyboard = new InputKeyboard({
      // ScaleTrianglesPlane
      l: timeFactor => this.scaleTrianglesPlane(-this.model.user.get("scaleValue") * timeFactor),
      k: timeFactor => this.scaleTrianglesPlane(this.model.user.get("scaleValue") * timeFactor),

      // Move
      left: timeFactor => this.moveX(-getMoveValue(timeFactor)),
      right: timeFactor => this.moveX(getMoveValue(timeFactor)),
      up: timeFactor => this.moveY(-getMoveValue(timeFactor)),
      down: timeFactor => this.moveY(getMoveValue(timeFactor)),
    });

    this.input.keyboardLoopDelayed = new InputKeyboard({
      // KeyboardJS is sensitive to ordering (complex combos first)
      "shift + f": (timeFactor, first) => this.moveZ(getMoveValue(timeFactor) * 5, first),
      "shift + d": (timeFactor, first) => this.moveZ(-getMoveValue(timeFactor) * 5, first),

      "shift + space": (timeFactor, first) => this.moveZ(-getMoveValue(timeFactor), first),
      "ctrl + space": (timeFactor, first) => this.moveZ(-getMoveValue(timeFactor), first),
      space: (timeFactor, first) => this.moveZ(getMoveValue(timeFactor), first),
      f: (timeFactor, first) => this.moveZ(getMoveValue(timeFactor), first),
      d: (timeFactor, first) => this.moveZ(-getMoveValue(timeFactor), first),
    }, this.model.user.get("keyboardDelay"));

    this.listenTo(this.model.user, "change:keyboardDelay",
      (model, value) => {
        if (this.input.keyboardLoopDelayed != null) {
          this.input.keyboardLoopDelayed.delay = value;
        }
      });

    this.input.keyboardNoLoop = new InputKeyboardNoLoop(this.getKeyboardControls());
  }


  getKeyboardControls(): Object {
    return {
      // Zoom in/out
      i: () => this.zoom(1, false),
      o: () => this.zoom(-1, false),

      // Change move value
      h: () => this.changeMoveValue(25),
      g: () => this.changeMoveValue(-25),
    };
  }


  init(): void {
    this.cameraController.setClippingDistance(this.model.user.get("clippingDistance"));
    this.sceneController.setClippingDistance(this.model.user.get("clippingDistance"));
  }


  start(): void {
    this.stop();

    this.sceneController.start();
    this.planeView.start();

    this.initKeyboard();
    this.init();
    this.initMouse();

    this.isStarted = true;
  }


  stop(): void {
    if (this.isStarted) {
      this.input.destroy();
    }

    this.sceneController.stop();
    this.planeView.stop();

    this.isStarted = false;
  }

  bindToEvents(): void {
    this.planeView.bindToEvents();

    this.listenTo(this.planeView, "render", this.render);
    this.listenTo(this.planeView, "renderCam", this.sceneController.updateSceneForCam);

    this.listenTo(this.sceneController, "newGeometries", list =>
      list.map(geometry =>
        this.planeView.addGeometry(geometry)),
    );
    this.listenTo(this.sceneController, "removeGeometries", list =>
      list.map(geometry =>
        this.planeView.removeGeometry(geometry)),
    );

    // TODO check for ControleMode rather the Object existence
    if (this.sceneController.skeleton) {
      this.listenTo(this.sceneController.skeleton, "newGeometries", list =>
        list.map(geometry =>
          this.planeView.addGeometry(geometry)),
      );
      this.listenTo(this.sceneController.skeleton, "removeGeometries", list =>
        list.map(geometry =>
          this.planeView.removeGeometry(geometry)),
      );
    }
  }


  render(): void {
    for (const dataLayerName of Object.keys(this.model.binary)) {
      if (this.sceneController.pingDataLayer(dataLayerName)) {
        this.model.binary[dataLayerName].ping(this.flycam.getPosition(), {
          zoomStep: this.flycam.getIntegerZoomStep(),
          areas: this.flycam.getAreas(),
          activePlane: this.activeViewport,
        });
      }
    }

    this.cameraController.update();
    this.sceneController.update();
  }


  move = (v: Vector3, increaseSpeedWithZoom: boolean = true) => {
    const { activeViewport } = this;
    if (activeViewport !== OrthoViews.TDView) {
      this.flycam.movePlane(v, activeViewport, increaseSpeedWithZoom);
    } else {
      this.moveTDView({ x: -v[0], y: -v[1] });
    }
  }


  moveX = (x: number): void => { this.move([x, 0, 0]); };

  moveY = (y: number): void => { this.move([0, y, 0]); };

  moveZ = (z: number, oneSlide: boolean): void => {
    const { activeViewport } = this;
    if (activeViewport === OrthoViews.TDView) {
      return;
    }

    if (oneSlide) {
      this.flycam.move(
        Dimensions.transDim(
          [0, 0, (z < 0 ? -1 : 1) << this.flycam.getIntegerZoomStep()],
          activeViewport),
        activeViewport);
    } else {
      this.move([0, 0, z], false);
    }
  }


  zoom(value: number, zoomToMouse: boolean): void {
    if ((OrthoViewValuesWithoutTDView).includes(this.activeViewport)) {
      this.zoomPlanes(value, zoomToMouse);
    } else {
      this.zoomTDView(value, zoomToMouse);
    }
  }


  zoomPlanes(value: number, zoomToMouse: boolean): void {
    if (zoomToMouse) {
      this.zoomPos = this.getMousePosition();
    }

    this.flycam.zoomByDelta(value);
    this.model.user.set("zoom", this.flycam.getPlaneScalingFactor());

    if (zoomToMouse) {
      this.finishZoom();
    }
  }


  zoomTDView(value: number, zoomToMouse: boolean = true): void {
    let zoomToPosition;
    if (zoomToMouse) {
      zoomToPosition = this.input.mouseControllers[OrthoViews.TDView].position;
    }
    this.cameraController.zoomTDView(value, zoomToPosition, this.planeView.curWidth);
  }


  moveTDView(delta: Point2): void {
    this.cameraController.moveTDViewX(delta.x * this.model.user.getMouseInversionX());
    this.cameraController.moveTDViewY(delta.y * this.model.user.getMouseInversionY());
  }


  finishZoom = (): void => {
    // Move the plane so that the mouse is at the same position as
    // before the zoom
    const { activeViewport } = this;
    if (this.isMouseOver() && activeViewport !== OrthoViews.TDView) {
      const mousePos = this.getMousePosition();
      const moveVector = [this.zoomPos[0] - mousePos[0],
        this.zoomPos[1] - mousePos[1],
        this.zoomPos[2] - mousePos[2]];
      this.flycam.move(moveVector, activeViewport);
    }
  }

  getMousePosition(): Vector3 {
    const pos = this.input.mouseControllers[this.activeViewport].position;
    if (pos != null) {
      return this.calculateGlobalPos(pos);
    }
    return [0, 0, 0];
  }


  isMouseOver(): boolean {
    return this.input.mouseControllers[this.activeViewport].isMouseOver;
  }


  changeMoveValue(delta: number): void {
    let moveValue = this.model.user.get("moveValue") + delta;
    moveValue = Math.min(constants.MAX_MOVE_VALUE, moveValue);
    moveValue = Math.max(constants.MIN_MOVE_VALUE, moveValue);

    this.model.user.set("moveValue", (Number)(moveValue));
  }


  scaleTrianglesPlane(delta: number): void {
    let scale = this.model.user.get("scale") + delta;
    scale = Math.min(constants.MAX_SCALE, scale);
    scale = Math.max(constants.MIN_SCALE, scale);

    this.model.user.set("scale", scale);
  }


  scrollPlanes(delta: number, type: ?ModifierKeys): void {
    switch (type) {
      case null:
        this.moveZ(delta, true);
        break;
      case "alt":
        this.zoomPlanes(Utils.clamp(-1, delta, 1), true);
        break;
      default: // ignore other cases
    }
  }


  calculateGlobalPos = (clickPos: Point2): Vector3 => {
    let position;
    const curGlobalPos = this.flycam.getPosition();
    const zoomFactor = this.flycam.getPlaneScalingFactor();
    const { scaleFactor } = this.planeView;
    const planeRatio = scaleInfo.baseVoxelFactors;
    switch (this.activeViewport) {
      case OrthoViews.PLANE_XY:
        position = [curGlobalPos[0] - (((((constants.VIEWPORT_WIDTH * scaleFactor) / 2) - clickPos.x) / scaleFactor) * planeRatio[0] * zoomFactor),
          curGlobalPos[1] - (((((constants.VIEWPORT_WIDTH * scaleFactor) / 2) - clickPos.y) / scaleFactor) * planeRatio[1] * zoomFactor),
          curGlobalPos[2]];
        break;
      case OrthoViews.PLANE_YZ:
        position = [curGlobalPos[0],
          curGlobalPos[1] - (((((constants.VIEWPORT_WIDTH * scaleFactor) / 2) - clickPos.y) / scaleFactor) * planeRatio[1] * zoomFactor),
          curGlobalPos[2] - (((((constants.VIEWPORT_WIDTH * scaleFactor) / 2) - clickPos.x) / scaleFactor) * planeRatio[2] * zoomFactor)];
        break;
      case OrthoViews.PLANE_XZ:
        position = [curGlobalPos[0] - (((((constants.VIEWPORT_WIDTH * scaleFactor) / 2) - clickPos.x) / scaleFactor) * planeRatio[0] * zoomFactor),
          curGlobalPos[1],
          curGlobalPos[2] - (((((constants.VIEWPORT_WIDTH * scaleFactor) / 2) - clickPos.y) / scaleFactor) * planeRatio[2] * zoomFactor)];
        break;
      default: throw new Error("Trying to calculate the global position, but no viewport is active:", this.activeViewport);
    }

    return position;
  }
}
PlaneController.initClass();

export default PlaneController;
