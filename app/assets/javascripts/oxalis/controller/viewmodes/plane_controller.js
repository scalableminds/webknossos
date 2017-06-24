/**
 * plane_controller.js
 * @flow
 */
 /* globals JQueryInputEventObject:false */

import app from "app";
import React from "react";
import Backbone from "backbone";
import $ from "jquery";
import _ from "lodash";
import Utils from "libs/utils";
import { InputMouse, InputKeyboard, InputKeyboardNoLoop } from "libs/input";
import * as THREE from "three";
import TrackballControls from "libs/trackball_controls";
import Model from "oxalis/model";
import Store from "oxalis/store";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import SceneController from "oxalis/controller/scene_controller";
import { getPosition, getRequestLogZoomStep, getIntegerZoomStep, getAreas, getPlaneScalingFactor } from "oxalis/model/accessors/flycam_accessor";
import { movePlaneFlycamOrthoAction, moveFlycamOrthoAction, zoomByDeltaAction } from "oxalis/model/actions/flycam_actions";
import { voxelToNm, getBaseVoxel, getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import CameraController from "oxalis/controller/camera_controller";
import Dimensions from "oxalis/model/dimensions";
import PlaneView from "oxalis/view/plane_view";
import constants, { OrthoViews, OrthoViewValues, OrthoViewValuesWithoutTDView } from "oxalis/constants";
import type { Point2, Vector3, OrthoViewType, OrthoViewMapType } from "oxalis/constants";
import type { ModifierKeys } from "libs/input";
import { setViewportAction } from "oxalis/model/actions/view_mode_actions";

class PlaneController extends React.PureComponent {
  // See comment in Controller class on general controller architecture.
  //
  // Plane Controller: Responsible for Plane Modes
  planeView: PlaneView;
  props: {
    onRender: () => void,
  }
  input: {
    mouseControllers: OrthoViewMapType<InputMouse>;
    keyboard?: InputKeyboard;
    keyboardNoLoop?: InputKeyboardNoLoop;
    keyboardLoopDelayed?: InputKeyboard;
  };
  isStarted: boolean;
  oldNmPos: Vector3;
  cameraController: CameraController;
  zoomPos: Vector3;
  controls: TrackballControls;
  canvasesAndNav: any;
  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;
  stopListening: Function;

  componentDidMount() {
    _.extend(this, Backbone.Events);
    this.input = {
      mouseControllers: {},
    };
    this.isStarted = false;

    const state = Store.getState();
    this.oldNmPos = voxelToNm(state.dataset.scale, getPosition(state.flycam));

    this.planeView = new PlaneView();

    Store.dispatch(setViewportAction(OrthoViews.PLANE_XY));

    // initialize Camera Controller
    this.cameraController = new CameraController(this.planeView.getCameras());

    this.canvasesAndNav = $("#main")[0];

    this.start();
  }

  componentWillUnmount() {
    this.stop();
  }

  initMouse(): void {
    for (const id of OrthoViewValues) {
      if (id !== OrthoViews.TDView) {
        const inputcatcherSelector = `#inputcatcher_${OrthoViews[id]}`;
        this.input.mouseControllers[id] =
          new InputMouse(inputcatcherSelector, this.getPlaneMouseControls(id), id);
      } else {
        this.input.mouseControllers[id] =
          new InputMouse("#inputcatcher_TDView", this.getTDViewMouseControls(), id);
      }
    }
  }


  getTDViewMouseControls(): Object {
    return {
      leftDownMove: (delta: Point2) => this.moveTDView(delta),
      scroll: (value: number) => this.zoomTDView(Utils.clamp(-1, value, 1), true),
      over: () => { Store.dispatch(setViewportAction(OrthoViews.TDView)); },
    };
  }


  getPlaneMouseControls(planeId: OrthoViewType): Object {
    return {
      leftDownMove: (delta: Point2) => {
        const mouseInversionX = Store.getState().userConfiguration.inverseX ? 1 : -1;
        const mouseInversionY = Store.getState().userConfiguration.inverseY ? 1 : -1;
        const viewportScale = Store.getState().userConfiguration.scale;
        return this.move([
          (delta.x * mouseInversionX) / viewportScale,
          (delta.y * mouseInversionY) / viewportScale,
          0,
        ]);
      },

      scroll: this.scrollPlanes.bind(this),
      over: () => { Store.dispatch(setViewportAction(planeId)); },
    };
  }


  initTrackballControls(): void {
    const view = $("#inputcatcher_TDView")[0];
    const state = Store.getState();
    const pos = voxelToNm(state.dataset.scale, getPosition(state.flycam));
    this.controls = new TrackballControls(
      this.planeView.getCameras()[OrthoViews.TDView],
      view,
      new THREE.Vector3(...pos),
      () => app.vent.trigger("rerender"));

    this.controls.noZoom = true;
    this.controls.noPan = true;
    this.controls.staticMoving = true;

    this.controls.target.set(
      ...pos);

    Store.subscribe(() => {
      const newState = Store.getState();
      const position = getPosition(newState.flycam);
      const nmPosition = voxelToNm(newState.dataset.scale, position);

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

    const callbacks = [
      this.cameraController.changeTDViewDiagonal,
      this.cameraController.changeTDViewXY,
      this.cameraController.changeTDViewYZ,
      this.cameraController.changeTDViewXZ,
    ];

    $("#TDViewControls button")
      .each((i, element) => $(element).on("click", () => { callbacks[i](); }));

    this.listenTo(this.cameraController, "cameraPositionChanged", this.controls.update);
  }


  initKeyboard(): void {
    // avoid scrolling while pressing space
    $(document).keydown((event: JQueryInputEventObject) => {
      if ((event.which === 32 || event.which === 18 || event.which >= 37 && event.which <= 40) && !$(":focus").length) {
        event.preventDefault();
      }
    });

    const getMoveValue = (timeFactor) => {
      const state = Store.getState();
      if (this.activeViewport === OrthoViews.TDView) {
        return (state.userConfiguration.moveValue * timeFactor) / getBaseVoxel(state.dataset.scale) / constants.FPS;
      }
      return (state.userConfiguration.moveValue * timeFactor) / getBaseVoxel(state.dataset.scale) / constants.FPS;
    };

    this.input.keyboard = new InputKeyboard({
      // ScaleTrianglesPlane
      l: (timeFactor) => {
        const scaleValue = Store.getState().userConfiguration.scaleValue;
        this.scaleTrianglesPlane(-scaleValue * timeFactor);
      },

      k: (timeFactor) => {
        const scaleValue = Store.getState().userConfiguration.scaleValue;
        this.scaleTrianglesPlane(scaleValue * timeFactor);
      },

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

      // Zoom in/out
      i: () => this.zoom(1, false),
      o: () => this.zoom(-1, false),
    }, Store.getState().userConfiguration.keyboardDelay);

    this.input.keyboardNoLoop = new InputKeyboardNoLoop(this.getKeyboardControls());

    Store.subscribe(() => {
      const keyboardLoopDelayed = this.input.keyboardLoopDelayed;
      if (keyboardLoopDelayed != null) {
        keyboardLoopDelayed.delay = Store.getState().userConfiguration.keyboardDelay;
      }
    });
  }


  getKeyboardControls(): Object {
    return {
      // Change move value
      h: () => this.changeMoveValue(25),
      g: () => this.changeMoveValue(-25),
    };
  }

  init(): void {
    const clippingDistance = Store.getState().userConfiguration.clippingDistance;
    this.cameraController.setClippingDistance(clippingDistance);
    SceneController.setClippingDistance(clippingDistance);
  }

  start(): void {
    this.bindToEvents();

    SceneController.startPlaneMode();
    this.planeView.start();

    this.initKeyboard();
    this.init();
    this.isStarted = true;

    // Workaround: defer mouse initialization to make sure DOM elements have
    // acutally been rendered by React (InputCatchers Component)
    // DOM Elements get deleted when switching between ortho and arbitrary mode
    const initInputHandlers = () => {
      if ($("#inputcatcher_TDView").length === 0) {
        window.requestAnimationFrame(initInputHandlers);
      } else if (this.isStarted === true) {
        this.initTrackballControls();
        this.initMouse();
      }
    };
    initInputHandlers();
  }

  stop(): void {
    if (this.isStarted) {
      this.destroyInput();
      this.controls.destroy();

      $("#TDViewControls button").off();
    }

    SceneController.stopPlaneMode();
    this.planeView.stop();
    this.stopListening();

    this.isStarted = false;
  }

  bindToEvents(): void {
    this.listenTo(this.planeView, "render", this.oldRender);
    this.listenTo(this.planeView, "renderCam", SceneController.updateSceneForCam);
    this.listenTo(this.planeView, "render", this.props.onRender);
  }


  oldRender(): void {
    const state = Store.getState();
    const activeViewport = state.viewModeData.plane.activeViewport;
    for (const dataLayerName of Object.keys(Model.binary)) {
      if (SceneController.pingDataLayer(dataLayerName)) {
        Model.binary[dataLayerName].ping(getPosition(state.flycam), {
          zoomStep: getRequestLogZoomStep(state),
          areas: getAreas(state),
          activePlane: activeViewport,
        });
      }
    }

    this.cameraController.update();
    SceneController.update();
  }


  move = (v: Vector3, increaseSpeedWithZoom: boolean = true) => {
    const activeViewport = Store.getState().viewModeData.plane.activeViewport;
    if (activeViewport !== OrthoViews.TDView) {
      Store.dispatch(movePlaneFlycamOrthoAction(v, activeViewport, increaseSpeedWithZoom));
    } else {
      this.moveTDView({ x: -v[0], y: -v[1] });
    }
  }


  moveX = (x: number): void => { this.move([x, 0, 0]); };

  moveY = (y: number): void => { this.move([0, y, 0]); };

  moveZ = (z: number, oneSlide: boolean): void => {
    const activeViewport = Store.getState().viewModeData.plane.activeViewport;
    if (activeViewport === OrthoViews.TDView) {
      return;
    }

    if (oneSlide) {
      Store.dispatch(moveFlycamOrthoAction(
        Dimensions.transDim(
          [0, 0, (z < 0 ? -1 : 1) * Math.max(1, getIntegerZoomStep(Store.getState()))],
          activeViewport),
        activeViewport));
    } else {
      this.move([0, 0, z], false);
    }
  }


  zoom(value: number, zoomToMouse: boolean): void {
    const activeViewport = Store.getState().viewModeData.plane.activeViewport;
    if ((OrthoViewValuesWithoutTDView).includes(activeViewport)) {
      this.zoomPlanes(value, zoomToMouse);
    } else {
      this.zoomTDView(value, zoomToMouse);
    }
  }


  zoomPlanes(value: number, zoomToMouse: boolean): void {
    if (zoomToMouse) {
      this.zoomPos = this.getMousePosition();
    }

    Store.dispatch(zoomByDeltaAction(value));

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
    const mouseInversionX = Store.getState().userConfiguration.inverseX ? 1 : -1;
    const mouseInversionY = Store.getState().userConfiguration.inverseY ? 1 : -1;

    this.cameraController.moveTDViewX(delta.x * mouseInversionX);
    this.cameraController.moveTDViewY(delta.y * mouseInversionY);
  }

  finishZoom = (): void => {
    // Move the plane so that the mouse is at the same position as
    // before the zoom
    const activeViewport = Store.getState().viewModeData.plane.activeViewport;
    if (this.isMouseOver() && activeViewport !== OrthoViews.TDView) {
      const mousePos = this.getMousePosition();
      const moveVector = [this.zoomPos[0] - mousePos[0],
        this.zoomPos[1] - mousePos[1],
        this.zoomPos[2] - mousePos[2]];
      Store.dispatch(moveFlycamOrthoAction(moveVector, activeViewport));
    }
  }

  getMousePosition(): Vector3 {
    const activeViewport = Store.getState().viewModeData.plane.activeViewport;
    const pos = this.input.mouseControllers[activeViewport].position;
    if (pos != null) {
      return this.calculateGlobalPos(pos);
    }
    return [0, 0, 0];
  }


  isMouseOver(): boolean {
    return this.input.mouseControllers[Store.getState().viewModeData.plane.activeViewport].isMouseOver;
  }


  changeMoveValue(delta: number): void {
    let moveValue = Store.getState().userConfiguration.moveValue + delta;
    moveValue = Math.min(constants.MAX_MOVE_VALUE, moveValue);
    moveValue = Math.max(constants.MIN_MOVE_VALUE, moveValue);

    Store.dispatch(updateUserSettingAction("moveValue", moveValue));
  }

  scaleTrianglesPlane(delta: number): void {
    let scale = Store.getState().userConfiguration.scale + delta;
    scale = Math.min(constants.MAX_SCALE, scale);
    scale = Math.max(constants.MIN_SCALE, scale);

    Store.dispatch(updateUserSettingAction("scale", scale));
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

  destroyInput() {
    for (const mouse of _.values(this.input.mouseControllers)) {
      mouse.destroy();
    }
    this.input.mouseControllers = {};
    Utils.__guard__(this.input.keyboard, x => x.destroy());
    Utils.__guard__(this.input.keyboardNoLoop, x1 => x1.destroy());
    Utils.__guard__(this.input.keyboardLoopDelayed, x2 => x2.destroy());
  }

  calculateGlobalPos = (clickPos: Point2): Vector3 => calculateGlobalPos(clickPos)

  render() {
    return null;
  }
}


function calculateGlobalPos(clickPos: Point2) {
  let position;
  const state = Store.getState();
  const activeViewport = state.viewModeData.plane.activeViewport;
  const curGlobalPos = getPosition(state.flycam);
  const zoomFactor = getPlaneScalingFactor(state.flycam);
  const viewportScale = state.userConfiguration.scale;
  const planeRatio = getBaseVoxelFactors(state.dataset.scale);
  switch (activeViewport) {
    case OrthoViews.PLANE_XY:
      position = [curGlobalPos[0] - (((((constants.VIEWPORT_WIDTH * viewportScale) / 2) - clickPos.x) / viewportScale) * planeRatio[0] * zoomFactor),
        curGlobalPos[1] - (((((constants.VIEWPORT_WIDTH * viewportScale) / 2) - clickPos.y) / viewportScale) * planeRatio[1] * zoomFactor),
        curGlobalPos[2]];
      break;
    case OrthoViews.PLANE_YZ:
      position = [curGlobalPos[0],
        curGlobalPos[1] - (((((constants.VIEWPORT_WIDTH * viewportScale) / 2) - clickPos.y) / viewportScale) * planeRatio[1] * zoomFactor),
        curGlobalPos[2] - (((((constants.VIEWPORT_WIDTH * viewportScale) / 2) - clickPos.x) / viewportScale) * planeRatio[2] * zoomFactor)];
      break;
    case OrthoViews.PLANE_XZ:
      position = [curGlobalPos[0] - (((((constants.VIEWPORT_WIDTH * viewportScale) / 2) - clickPos.x) / viewportScale) * planeRatio[0] * zoomFactor),
        curGlobalPos[1],
        curGlobalPos[2] - (((((constants.VIEWPORT_WIDTH * viewportScale) / 2) - clickPos.y) / viewportScale) * planeRatio[2] * zoomFactor)];
      break;
    default: throw new Error(`Trying to calculate the global position, but no viewport is active: ${activeViewport}`);
  }

  return position;
}

export default PlaneController;
