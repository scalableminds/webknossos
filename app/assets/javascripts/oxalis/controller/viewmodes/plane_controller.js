import app from "app";
import Backbone from "backbone";
import $ from "jquery";
import _ from "lodash";
import "three.trackball";
import Utils from "libs/utils";
import Input from "libs/input";
import THREE from "three";
import CameraController from "../camera_controller";
import Dimensions from "../../model/dimensions";
import PlaneView from "../../view/plane_view";
import constants from "../../constants";

class PlaneController {
  static initClass() {
    // See comment in Controller class on general controller architecture.
    //
    // Plane Controller: Responsible for Plane Modes


    this.prototype.bindings = [];
    this.prototype.model = null;
    this.prototype.view = null;

    this.prototype.input = {
      mouseControllers: [],
      keyboard: null,
      keyboardNoLoop: null,
      keyboardLoopDelayed: null,

      destroy() {
        for (const mouse of this.mouseControllers) {
          mouse.destroy();
        }
        this.mouseControllers = [];
        __guard__(this.keyboard, x => x.destroy());
        __guard__(this.keyboardNoLoop, x1 => x1.destroy());
        return __guard__(this.keyboardLoopDelayed, x2 => x2.destroy());
      },
    };
  }


  constructor(model, view, sceneController) {
    this.move = this.move.bind(this);
    this.moveX = this.moveX.bind(this);
    this.moveY = this.moveY.bind(this);
    this.moveZ = this.moveZ.bind(this);
    this.finishZoom = this.finishZoom.bind(this);
    this.scrollPlanes = this.scrollPlanes.bind(this);
    this.calculateGlobalPos = this.calculateGlobalPos.bind(this);
    this.model = model;
    this.view = view;
    this.sceneController = sceneController;
    _.extend(this, Backbone.Events);

    this.isStarted = false;

    this.flycam = this.model.flycam;

    this.oldNmPos = app.scaleInfo.voxelToNm(this.flycam.getPosition());

    this.planeView = new PlaneView(this.model, this.view);

    this.activeViewport = constants.PLANE_XY;

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
    $("#TDViewControls button").each((i, element) => $(element).on("click", callbacks[i]),
    );

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


  initMouse() {
    for (let planeId = 0; planeId <= 2; planeId++) {
      ((planeId) => {
        const inputcatcher = $(`#plane${constants.PLANE_NAMES[planeId]}`);
        return this.input.mouseControllers.push(
          new Input.Mouse(inputcatcher, this.getPlaneMouseControls(planeId), planeId));
      })(planeId);
    }

    return this.input.mouseControllers.push(
      new Input.Mouse($("#TDView"), this.getTDViewMouseControls(), constants.TDView));
  }


  getTDViewMouseControls() {
    return {
      leftDownMove: delta => this.moveTDView(delta),
      scroll: value => this.zoomTDView(Utils.clamp(-1, value, 1), true),
      over: () => this.planeView.setActiveViewport(this.activeViewport = constants.TDView),
    };
  }


  getPlaneMouseControls(planeId) {
    return {

      leftDownMove: (delta) => this.move([
        (delta.x * this.model.user.getMouseInversionX()) / this.planeView.scaleFactor,
        (delta.y * this.model.user.getMouseInversionY()) / this.planeView.scaleFactor,
        0,
      ]),

      over: () => {
        $(":focus").blur();
        return this.planeView.setActiveViewport(this.activeViewport = planeId);
      },

      scroll: this.scrollPlanes,
    };
  }


  initTrackballControls() {
    const view = $("#TDView")[0];
    const pos = app.scaleInfo.voxelToNm(this.flycam.getPosition());
    this.controls = new THREE.TrackballControls(
      this.planeView.getCameras()[constants.TDView],
      view,
      new THREE.Vector3(...pos),
      () => app.vent.trigger("rerender"));

    this.controls.noZoom = true;
    this.controls.noPan = true;
    this.controls.staticMoving = true;

    this.controls.target.set(
      ...app.scaleInfo.voxelToNm(this.flycam.getPosition()));

    this.listenTo(this.flycam, "positionChanged", function (position) {
      const nmPosition = app.scaleInfo.voxelToNm(position);

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

    return this.listenTo(this.cameraController, "cameraPositionChanged", this.controls.update);
  }


  initKeyboard() {
    // avoid scrolling while pressing space
    $(document).keydown((event) => {
      if ((event.which === 32 || event.which === 18 || event.which >= 37 && event.which <= 40) && !$(":focus").length) { event.preventDefault(); }
    });

    const getMoveValue = (timeFactor) => {
      if (([0, 1, 2]).includes(this.activeViewport)) {
        return (this.model.user.get("moveValue") * timeFactor) / app.scaleInfo.baseVoxel / constants.FPS;
      }
      return (constants.TDView_MOVE_SPEED * timeFactor) / constants.FPS;
    };

    this.input.keyboard = new Input.Keyboard({

      // ScaleTrianglesPlane
      l: timeFactor => this.scaleTrianglesPlane(-this.model.user.get("scaleValue") * timeFactor),
      k: timeFactor => this.scaleTrianglesPlane(this.model.user.get("scaleValue") * timeFactor),

      // Move
      left: timeFactor => this.moveX(-getMoveValue(timeFactor)),
      right: timeFactor => this.moveX(getMoveValue(timeFactor)),
      up: timeFactor => this.moveY(-getMoveValue(timeFactor)),
      down: timeFactor => this.moveY(getMoveValue(timeFactor)),

    });

    this.input.keyboardLoopDelayed = new Input.Keyboard({

      // KeyboardJS is sensitive to ordering (complex combos first)
      "shift + f": (timeFactor, first) => this.moveZ(getMoveValue(timeFactor) * 5, first),
      "shift + d": (timeFactor, first) => this.moveZ(-getMoveValue(timeFactor) * 5, first),

      "shift + space": (timeFactor, first) => this.moveZ(-getMoveValue(timeFactor), first),
      "ctrl + space": (timeFactor, first) => this.moveZ(-getMoveValue(timeFactor), first),
      space: (timeFactor, first) => this.moveZ(getMoveValue(timeFactor), first),
      f: (timeFactor, first) => this.moveZ(getMoveValue(timeFactor), first),
      d: (timeFactor, first) => this.moveZ(-getMoveValue(timeFactor), first),
    }

    , this.model.user.get("keyboardDelay"),
    );

    this.listenTo(this.model.user, "change:keyboardDelay", function (model, value) { return this.input.keyboardLoopDelayed.delay = value; });

    this.input.keyboardNoLoop = new Input.KeyboardNoLoop(this.getKeyboardControls());
  }


  getKeyboardControls() {
    return {
      // Zoom in/out
      i: () => this.zoom(1, false),
      o: () => this.zoom(-1, false),

      // Change move value
      h: () => this.changeMoveValue(25),
      g: () => this.changeMoveValue(-25),
    };
  }


  init() {
    this.cameraController.setClippingDistance(this.model.user.get("clippingDistance"));
    return this.sceneController.setClippingDistance(this.model.user.get("clippingDistance"));
  }


  start() {
    this.stop();

    this.sceneController.start();
    this.planeView.start();

    this.initKeyboard();
    this.init();
    this.initMouse();

    this.isStarted = true;
  }


  stop() {
    if (this.isStarted) {
      this.input.destroy();
    }

    this.sceneController.stop();
    this.planeView.stop();

    this.isStarted = false;
  }

  bindToEvents() {
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
      return this.listenTo(this.sceneController.skeleton, "removeGeometries", list =>
        list.map(geometry =>
          this.planeView.removeGeometry(geometry)),
      );
    }
  }


  render() {
    for (const dataLayerName in this.model.binary) {
      if (this.sceneController.pingDataLayer(dataLayerName)) {
        this.model.binary[dataLayerName].ping(this.flycam.getPosition(), {
          zoomStep: this.flycam.getIntegerZoomStep(),
          area: this.flycam.getAreas(),
          activePlane: this.activeViewport,
        });
      }
    }

    this.cameraController.update();
    return this.sceneController.update();
  }


  move(v, increaseSpeedWithZoom = true) {
    if (([0, 1, 2]).includes(this.activeViewport)) {
      return this.flycam.movePlane(v, this.activeViewport, increaseSpeedWithZoom);
    }
    return this.moveTDView({ x: -v[0], y: -v[1] });
  }


  moveX(x) { return this.move([x, 0, 0]); }

  moveY(y) { return this.move([0, y, 0]); }

  moveZ(z, oneSlide) {
    if (this.activeViewport === constants.TDView) {
      return;
    }

    if (oneSlide) {
      return this.flycam.move(
        Dimensions.transDim(
          [0, 0, (z < 0 ? -1 : 1) << this.flycam.getIntegerZoomStep()],
          this.activeViewport),
        this.activeViewport);
    } else {
      return this.move([0, 0, z], false);
    }
  }


  zoom(value, zoomToMouse) {
    if (([0, 1, 2]).includes(this.activeViewport)) {
      return this.zoomPlanes(value, zoomToMouse);
    } else {
      return this.zoomTDView(value, zoomToMouse);
    }
  }


  zoomPlanes(value, zoomToMouse) {
    if (zoomToMouse) {
      this.zoomPos = this.getMousePosition();
    }

    this.flycam.zoomByDelta(value);
    this.model.user.set("zoom", this.flycam.getPlaneScalingFactor());

    if (zoomToMouse) {
      return this.finishZoom();
    }
  }


  zoomTDView(value, zoomToMouse) {
    let zoomToPosition;
    if (zoomToMouse) {
      zoomToPosition = this.input.mouseControllers[constants.TDView].position;
    }

    return this.cameraController.zoomTDView(value, zoomToPosition, this.planeView.curWidth);
  }


  moveTDView(delta) {
    this.cameraController.moveTDViewX(delta.x * this.model.user.getMouseInversionX());
    return this.cameraController.moveTDViewY(delta.y * this.model.user.getMouseInversionY());
  }


  finishZoom() {
    // Move the plane so that the mouse is at the same position as
    // before the zoom
    if (this.isMouseOver()) {
      const mousePos = this.getMousePosition();
      const moveVector = [this.zoomPos[0] - mousePos[0],
        this.zoomPos[1] - mousePos[1],
        this.zoomPos[2] - mousePos[2]];
      return this.flycam.move(moveVector, this.activeViewport);
    }
  }

  getMousePosition() {
    const pos = this.input.mouseControllers[this.activeViewport].position;
    return this.calculateGlobalPos(pos);
  }


  isMouseOver() {
    return this.input.mouseControllers[this.activeViewport].isMouseOver;
  }


  changeMoveValue(delta) {
    let moveValue = this.model.user.get("moveValue") + delta;
    moveValue = Math.min(constants.MAX_MOVE_VALUE, moveValue);
    moveValue = Math.max(constants.MIN_MOVE_VALUE, moveValue);

    return this.model.user.set("moveValue", (Number)(moveValue));
  }


  scaleTrianglesPlane(delta) {
    let scale = this.model.user.get("scale") + delta;
    scale = Math.min(constants.MAX_SCALE, scale);
    scale = Math.max(constants.MIN_SCALE, scale);

    return this.model.user.set("scale", scale);
  }


  scrollPlanes(delta, type) {
    switch (type) {
      case null: return this.moveZ(delta, true);
      case "alt":
        return this.zoomPlanes(Utils.clamp(-1, delta, 1), true);
    }
  }


  calculateGlobalPos(clickPos) {
    let position;
    const curGlobalPos = this.flycam.getPosition();
    const zoomFactor = this.flycam.getPlaneScalingFactor();
    const { scaleFactor } = this.planeView;
    const planeRatio = app.scaleInfo.baseVoxelFactors;
    switch (this.activeViewport) {
      case constants.PLANE_XY:
        position = [curGlobalPos[0] - (((((constants.VIEWPORT_WIDTH * scaleFactor) / 2) - clickPos.x) / scaleFactor) * planeRatio[0] * zoomFactor),
          curGlobalPos[1] - (((((constants.VIEWPORT_WIDTH * scaleFactor) / 2) - clickPos.y) / scaleFactor) * planeRatio[1] * zoomFactor),
          curGlobalPos[2]];
        break;
      case constants.PLANE_YZ:
        position = [curGlobalPos[0],
          curGlobalPos[1] - (((((constants.VIEWPORT_WIDTH * scaleFactor) / 2) - clickPos.y) / scaleFactor) * planeRatio[1] * zoomFactor),
          curGlobalPos[2] - (((((constants.VIEWPORT_WIDTH * scaleFactor) / 2) - clickPos.x) / scaleFactor) * planeRatio[2] * zoomFactor)];
        break;
      case constants.PLANE_XZ:
        position = [curGlobalPos[0] - (((((constants.VIEWPORT_WIDTH * scaleFactor) / 2) - clickPos.x) / scaleFactor) * planeRatio[0] * zoomFactor),
          curGlobalPos[1],
          curGlobalPos[2] - (((((constants.VIEWPORT_WIDTH * scaleFactor) / 2) - clickPos.y) / scaleFactor) * planeRatio[2] * zoomFactor)];
        break;
    }

    return position;
  }
}
PlaneController.initClass();

export default PlaneController;

function __guard__(value, transform) {
  return (typeof value !== "undefined" && value !== null) ? transform(value) : undefined;
}
