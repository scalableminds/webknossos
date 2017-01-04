import app from "app";
import Backbone from "backbone";
import $ from "jquery";
import _ from "lodash";
import TWEEN from "tween.js";
import Input from "libs/input";
import ArbitraryPlane from "../../geometries/arbitrary_plane";
import Crosshair from "../../geometries/crosshair";
import ArbitraryView from "../../view/arbitrary_view";
import ArbitraryPlaneInfo from "../../geometries/arbitrary_plane_info";
import constants from "../../constants";
import { M4x4, V3 } from "libs/mjs";
import Utils from "libs/utils";
import Toast from "libs/toast";
import modal from "../../view/modal";

class ArbitraryController {
  static initClass() {
    // See comment in Controller class on general controller architecture.
    //
    // Arbitrary Controller: Responsible for Arbitrary Modes

    this.prototype.WIDTH = 128;
    this.prototype.TIMETOCENTER = 200;


    this.prototype.plane = null;
    this.prototype.crosshair = null;
    this.prototype.cam = null;

    this.prototype.fullscreen = false;
    this.prototype.lastNodeMatrix = null;

    this.prototype.model = null;
    this.prototype.view = null;

    this.prototype.input = {
      mouse: null,
      keyboard: null,
      keyboardNoLoop: null,
      keyboardOnce: null,

      destroy() {
        __guard__(this.mouse, x => x.destroy());
        __guard__(this.keyboard, x1 => x1.destroy());
        __guard__(this.keyboardNoLoop, x2 => x2.destroy());
        return __guard__(this.keyboardOnce, x3 => x3.destroy());
      },
    };
  }


  constructor(model, view, sceneController, skeletonTracingController) {
    let canvas;
    this.scroll = this.scroll.bind(this);
    this.addNode = this.addNode.bind(this);
    this.setWaypoint = this.setWaypoint.bind(this);
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

    this.crosshair = new Crosshair(this.cam, this.model.user.get("crosshairSize"));
    this.arbitraryView.addGeometry(this.crosshair);

    this.listenTo(this.model.user, "change:displayCrosshair", function (model, value) {
      return this.crosshair.setVisibility(value);
    });

    this.bindToEvents();
    this.arbitraryView.draw();

    this.stop();

    this.crosshair.setVisibility(this.model.user.get("displayCrosshair"));
  }


  render(forceUpdate, event) {
    const matrix = this.cam.getMatrix();
    return this.model.getColorBinaries().map(binary =>
      binary.arbitraryPing(matrix, this.model.datasetConfiguration.get("quality")));
  }


  initMouse() {
    return this.input.mouse = new Input.Mouse(
      this.canvas, {
        leftDownMove: (delta) => {
          if (this.mode === constants.MODE_ARBITRARY) {
            this.cam.yaw(
            -delta.x * this.model.user.getMouseInversionX() * this.model.user.get("mouseRotateValue"),
            true,
          );
            return this.cam.pitch(
            delta.y * this.model.user.getMouseInversionY() * this.model.user.get("mouseRotateValue"),
            true,
          );
          } else if (this.mode === constants.MODE_ARBITRARY_PLANE) {
            const f = this.cam.getZoomStep() / (this.arbitraryView.width / this.WIDTH);
            return this.cam.move([delta.x * f, delta.y * f, 0]);
          }
        },
        rightClick: (pos, plane, event) => this.createBranchMarker(pos),

        scroll: this.scroll,
      },
    );
  }


  initKeyboard() {
    this.input.keyboard = new Input.Keyboard({

      // KeyboardJS is sensitive to ordering (complex combos first)

      // Scale plane
      l: timeFactor => this.arbitraryView.applyScale(-this.model.user.get("scaleValue")),
      k: timeFactor => this.arbitraryView.applyScale(this.model.user.get("scaleValue")),

      // Move
      space: (timeFactor) => {
        this.setRecord(true);
        return this.move(timeFactor);
      },
      "ctrl + space": (timeFactor) => {
        this.setRecord(true);
        return this.move(-timeFactor);
      },

      f: (timeFactor) => {
        this.setRecord(false);
        return this.move(timeFactor);
      },
      d: (timeFactor) => {
        this.setRecord(false);
        return this.move(-timeFactor);
      },

      // Rotate at centre
      "shift + left": timeFactor => this.cam.yaw(this.model.user.get("rotateValue") * timeFactor),
      "shift + right": timeFactor => this.cam.yaw(-this.model.user.get("rotateValue") * timeFactor),
      "shift + up": timeFactor => this.cam.pitch(this.model.user.get("rotateValue") * timeFactor),
      "shift + down": timeFactor => this.cam.pitch(-this.model.user.get("rotateValue") * timeFactor),

      // Rotate in distance
      left: timeFactor => this.cam.yaw(this.model.user.get("rotateValue") * timeFactor, this.mode === constants.MODE_ARBITRARY),
      right: timeFactor => this.cam.yaw(-this.model.user.get("rotateValue") * timeFactor, this.mode === constants.MODE_ARBITRARY),
      up: timeFactor => this.cam.pitch(-this.model.user.get("rotateValue") * timeFactor, this.mode === constants.MODE_ARBITRARY),
      down: timeFactor => this.cam.pitch(this.model.user.get("rotateValue") * timeFactor, this.mode === constants.MODE_ARBITRARY),

      // Zoom in/out
      i: timeFactor => this.cam.zoomIn(),
      o: timeFactor => this.cam.zoomOut(),

      // Change move value
      h: timeFactor => this.changeMoveValue(25),
      g: timeFactor => this.changeMoveValue(-25),
    });

    this.input.keyboardNoLoop = new Input.KeyboardNoLoop({

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

    return this.input.keyboardOnce = new Input.Keyboard(

      // Delete active node and recenter last node
      { "shift + space": () => this.deleteActiveNode() }
    , -1);
  }


  setRecord(record) {
    if (record !== this.model.get("flightmodeRecording")) {
      this.model.set("flightmodeRecording", record);
      return this.setWaypoint();
    }
  }


  createBranchMarker(pos) {
    if (!this.isBranchpointvideoMode() && !this.isSynapseannotationMode()) { return; }
    const activeNode = this.model.skeletonTracing.getActiveNode();
    this.model.setMode(2);
    const f = this.cam.getZoomStep() / (this.arbitraryView.width / this.WIDTH);
    this.cam.move([-(pos.x - (this.arbitraryView.width / 2)) * f, -(pos.y - (this.arbitraryView.width / 2)) * f, 0]);
    const position = this.cam.getPosition();
    const rotation = this.cam.getRotation();
    this.model.skeletonTracing.createNewTree();
    this.addNode(position, rotation);
    this.cam.move([(pos.x - (this.arbitraryView.width / 2)) * f, (pos.y - (this.arbitraryView.width / 2)) * f, 0]);
    if (this.isBranchpointvideoMode()) {
      this.setActiveNode(activeNode.id, true);
    }
    this.model.setMode(1);
    return this.moved();
  }


  nextNode(nextOne) {
    if (!this.isBranchpointvideoMode()) { return; }
    const activeNode = this.model.skeletonTracing.getActiveNode();
    if ((nextOne && activeNode.id === this.model.skeletonTracing.getActiveTree().nodes.length) || (!nextOne && activeNode.id === 1)) {
      return;
    }
    this.setActiveNode(((activeNode.id + (2 * nextOne)) - 1), true); // implicit cast from boolean to int
    if ((this.view.theme === constants.THEME_BRIGHT) !== nextOne) { // switch background to black for backwards move
      return this.view.toggleTheme();
    }
  }


  getVoxelOffset(timeFactor) {
    return (this.model.user.get("moveValue3d") * timeFactor) / app.scaleInfo.baseVoxel / constants.FPS;
  }


  move(timeFactor) {
    if (!this.isStarted) { return; }
    if (this.isBranchpointvideoMode()) { return; }
    this.cam.move([0, 0, this.getVoxelOffset(timeFactor)]);
    return this.moved();
  }


  init() {
    this.setClippingDistance(this.model.user.get("clippingDistanceArbitrary"));
    return this.arbitraryView.applyScale(0);
  }


  bindToEvents() {
    this.listenTo(this.arbitraryView, "render", this.render);

    for (const name in this.model.binary) {
      const binary = this.model.binary[name];
      this.listenTo(binary.cube, "bucketLoaded", this.arbitraryView.draw);
    }

    this.listenTo(this.model.user, "change:crosshairSize", function (model, value) {
      return this.crosshair.setScale(value);
    });
    this.listenTo(this.model.user, { "change:sphericalCapRadius": function (model, value) {
      this.model.flycam3d.distance = value;
      return this.plane.setMode(this.mode);
    },
    },
    );
    return this.listenTo(this.model.user, "change:clippingDistanceArbitrary", function (model, value) {
      return this.setClippingDistance(value);
    });
  }


  start(mode) {
    this.mode = mode;
    this.stop();

    this.plane.setMode(this.mode);

    this.initKeyboard();
    this.initMouse();
    this.arbitraryView.start();
    this.init();
    this.arbitraryView.draw();

    return this.isStarted = true;
  }


  stop() {
    if (this.isStarted) {
      this.input.destroy();
    }

    this.arbitraryView.stop();

    return this.isStarted = false;
  }


  scroll(delta, type) {
    switch (type) {
      case "shift": return this.setParticleSize(Utils.clamp(-1, delta, 1));
    }
  }


  addNode(position, rotation) {
    if (!this.isStarted) { return; }
    const datasetConfig = this.model.get("datasetConfiguration");
    const fourBit = datasetConfig.get("fourBit") ? 4 : 8;
    const interpolation = datasetConfig.get("interpolation");

    return this.model.skeletonTracing.addNode(position, rotation, constants.ARBITRARY_VIEW, 0, fourBit, interpolation);
  }


  setWaypoint() {
    if (!this.model.get("flightmodeRecording")) {
      return;
    }

    const position = this.cam.getPosition();
    const rotation = this.cam.getRotation();

    return this.addNode(position, rotation);
  }


  changeMoveValue(delta) {
    let moveValue = this.model.user.get("moveValue3d") + delta;
    moveValue = Math.min(constants.MAX_MOVE_VALUE, moveValue);
    moveValue = Math.max(constants.MIN_MOVE_VALUE, moveValue);

    return this.model.user.set("moveValue3d", (Number)(moveValue));
  }


  setParticleSize(delta) {
    let particleSize = this.model.user.get("particleSize") + delta;
    particleSize = Math.min(constants.MAX_PARTICLE_SIZE, particleSize);
    particleSize = Math.max(constants.MIN_PARTICLE_SIZE, particleSize);

    return this.model.user.set("particleSize", (Number)(particleSize));
  }


  setClippingDistance(value) {
    if (this.isBranchpointvideoMode()) {
      return this.arbitraryView.setClippingDistance(constants.BRANCHPOINT_VIDEO_CLIPPING_DISTANCE);
    } else {
      return this.arbitraryView.setClippingDistance(value);
    }
  }


  pushBranch() {
    this.setWaypoint();
    this.model.skeletonTracing.pushBranch();
    return Toast.success("Branchpoint set");
  }


  popBranch() {
    return _.defer(() => this.model.skeletonTracing.popBranch().then((id) => {
      this.setActiveNode(id, true);
      if (id === 1) {
        this.cam.yaw(Math.PI);
        Toast.warning("Reached initial node, view reversed");
        return this.model.commentTabView.appendComment("reversed");
      }
    },
    ),
    );
  }


  centerActiveNode() {
    const activeNode = this.model.skeletonTracing.getActiveNode();
    if (activeNode) {
      // animate the change to the new position and new rotation
      const curPos = this.cam.getPosition();
      const newPos = this.model.skeletonTracing.getActiveNodePos();
      const curRotation = this.cam.getRotation();
      let newRotation = this.model.skeletonTracing.getActiveNodeRotation();
      newRotation = this.getShortestRotation(curRotation, newRotation);

      const waypointAnimation = new TWEEN.Tween(
        { x: curPos[0], y: curPos[1], z: curPos[2], rx: curRotation[0], ry: curRotation[1], rz: curRotation[2], cam: this.cam });
      waypointAnimation.to(
        { x: newPos[0], y: newPos[1], z: newPos[2], rx: newRotation[0], ry: newRotation[1], rz: newRotation[2] }, this.TIMETOCENTER);
      waypointAnimation.onUpdate(function () {
        this.cam.setPosition([this.x, this.y, this.z]);
        return this.cam.setRotation([this.rx, this.ry, this.rz]);
      });
      waypointAnimation.start();

      return this.cam.update();
    }
  }


  setActiveNode(nodeId, centered, mergeTree) {
    this.model.skeletonTracing.setActiveNode(nodeId, mergeTree);
    this.cam.setPosition(this.model.skeletonTracing.getActiveNodePos());
    return this.cam.setRotation(this.model.skeletonTracing.getActiveNodeRotation());
  }


  deleteActiveNode() {
    const { skeletonTracing } = this.model;
    const activeNode = skeletonTracing.getActiveNode();
    if (activeNode.neighbors.length > 1) {
      return Toast.error("Unable: Attempting to cut skeleton");
    } else {
      return _.defer(() => this.model.skeletonTracing.deleteActiveNode().then(
        () => this.centerActiveNode(),
      ),
      );
    }
  }


  getShortestRotation(curRotation, newRotation) {
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


  moved() {
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
      return this.lastNodeMatrix = matrix;
    }
  }


  isBranchpointvideoMode() {
    return __guard__(this.model.tracing.task, x => x.type.summary) === "branchpointvideo";
  }


  isSynapseannotationMode() {
    return __guard__(this.model.tracing.task, x => x.type.summary) === "synapseannotation";
  }
}
ArbitraryController.initClass();


export default ArbitraryController;

function __guard__(value, transform) {
  return (typeof value !== "undefined" && value !== null) ? transform(value) : undefined;
}
