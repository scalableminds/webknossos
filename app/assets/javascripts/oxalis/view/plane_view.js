import _ from "lodash";
import app from "app";
import Backbone from "backbone";
import $ from "jquery";
import TWEEN from "tween.js";
import * as THREE from "three";
import Store from "oxalis/store";
import modal from "./modal";
import Toast from "../../libs/toast";
import constants from "../constants";

class PlaneView {

  constructor(model, view) {
    let HEIGHT;
    let WIDTH;
    this.resize = this.resize.bind(this);
    this.scaleTrianglesPlane = this.scaleTrianglesPlane.bind(this);
    this.setActiveViewport = this.setActiveViewport.bind(this);
    this.getCameras = this.getCameras.bind(this);
    this.model = model;
    this.view = view;
    _.extend(this, Backbone.Events);

    this.renderer = this.view.renderer;
    this.scene = this.view.scene;
    this.running = false;

    // The "render" div serves as a container for the canvas, that is
    // attached to it once a renderer has been initalized.
    const container = $("#render");

    // Create a 4x4 grid
    this.curWidth = WIDTH = HEIGHT = constants.VIEWPORT_WIDTH;
    this.scaleFactor = 1;

    // Initialize main THREE.js components
    this.camera = new Array(4);
    this.lights = new Array(3);

    for (const i of constants.ALL_VIEWPORTS) {
      // Let's set up cameras
      // No need to set any properties, because the camera controller will deal with that
      this.camera[i] = new THREE.OrthographicCamera(0, 0, 0, 0);
      this.scene.add(this.camera[i]);
    }

    this.camera[constants.PLANE_XY].position.z = -1;
    this.camera[constants.PLANE_YZ].position.x = 1;
    this.camera[constants.PLANE_XZ].position.y = 1;
    this.camera[constants.TDView].position.copy(new THREE.Vector3(10, 10, -10));
    this.camera[constants.PLANE_XY].up = new THREE.Vector3(0, -1, 0);
    this.camera[constants.PLANE_YZ].up = new THREE.Vector3(0, -1, 0);
    this.camera[constants.PLANE_XZ].up = new THREE.Vector3(0, 0, -1);
    this.camera[constants.TDView].up = new THREE.Vector3(0, 0, -1);
    for (const cam of this.camera) {
      cam.lookAt(new THREE.Vector3(0, 0, 0));
    }

    // Because the voxel coordinates do not have a cube shape but are distorted,
    // we need to distort the entire scene to provide an illustration that is
    // proportional to the actual size in nm.
    // For some reason, all objects have to be put into a group object. Changing
    // scene.scale does not have an effect.
    this.group = new THREE.Object3D();
    // The dimension(s) with the highest resolution will not be distorted
    this.group.scale.copy(app.scaleInfo.getNmPerVoxelVector());
    // Add scene to the group, all Geometries are than added to group
    this.scene.add(this.group);

    this.scene.add(new THREE.AmbientLight(0x333333));
    let directionalLight = new THREE.DirectionalLight(0xffffff, 0.3);
    directionalLight.position.set(1, 1, -1).normalize();
    this.scene.add(directionalLight);
    directionalLight = new THREE.DirectionalLight(0xffffff, 0.3);
    directionalLight.position.set(-1, -1, -1).normalize();
    this.scene.add(directionalLight);

    // Attach the canvas to the container
    this.renderer.setSize((2 * WIDTH) + 20, (2 * HEIGHT) + 20);
    $(this.renderer.domElement).attr({ id: "render-canvas" });
    container.append(this.renderer.domElement);

    this.setActiveViewport(constants.PLANE_XY);

    this.first = true;
    this.newTextures = [true, true, true, true];

    this.needsRerender = true;
    app.vent.on("rerender", () => { this.needsRerender = true; });
  }


  animate() {
    if (!this.running) { return; }

    this.renderFunction();

    window.requestAnimationFrame(() => this.animate());
  }

  renderFunction() {
    // This is the main render function.
    // All 3D meshes and the trianglesplane are rendered here.

    TWEEN.update();

    // skip rendering if nothing has changed
    // This prevents you the GPU/CPU from constantly
    // working and keeps your lap cool
    // ATTENTION: this limits the FPS to 30 FPS (depending on the keypress update frequence)

    let modelChanged = false;
    for (const name of Object.keys(this.model.binary)) {
      const binary = this.model.binary[name];
      for (const plane of binary.planes) {
        modelChanged |= plane.hasChanged();
      }
    }

    if (this.needsRerender || modelChanged) {
      this.trigger("render");

      const viewport = [
        [0, this.curWidth + 20],
        [this.curWidth + 20, this.curWidth + 20],
        [0, 0],
        [this.curWidth + 20, 0],
      ];
      this.renderer.autoClear = true;

      const setupRenderArea = (x, y, width, color) => {
        this.renderer.setViewport(x, y, width, width);
        this.renderer.setScissor(x, y, width, width);
        this.renderer.setScissorTest(true);
        this.renderer.setClearColor(color, 1);
      };

      setupRenderArea(0, 0, this.renderer.domElement.width, 0xffffff);
      this.renderer.clear();

      for (const i of constants.ALL_VIEWPORTS) {
        this.trigger("renderCam", i);
        setupRenderArea(
          viewport[i][0],
          viewport[i][1],
          this.curWidth,
          constants.PLANE_COLORS[i],
        );
        this.renderer.render(this.scene, this.camera[i]);
      }

      this.needsRerender = false;
    }
  }

  addGeometry(geometry) {
    // Adds a new Three.js geometry to the scene.
    // This provides the public interface to the GeometryFactory.

    this.group.add(geometry);
  }


  removeGeometry(geometry) {
    this.group.remove(geometry);
    this.draw();
  }


  draw() {
    app.vent.trigger("rerender");
  }


  resizeThrottled() {
    // throttle resize to avoid annoying flickering
    this.resizeThrottled = _.throttle(
      () => {
        this.resize();
        app.vent.trigger("planes:resize");
      },
      constants.RESIZE_THROTTLE_TIME,
    );
    this.resizeThrottled();
  }


  resize() {
    // Call this after the canvas was resized to fix the viewport
    const canvas = $("#render-canvas");
    const WIDTH = (canvas.width() - 20) / 2;
    const HEIGHT = (canvas.height() - 20) / 2;

    this.renderer.setSize((2 * WIDTH) + 20, (2 * HEIGHT) + 20);
    for (const i of constants.ALL_VIEWPORTS) {
      this.camera[i].aspect = WIDTH / HEIGHT;
      this.camera[i].updateProjectionMatrix();
    }
    this.draw();
  }


  scaleTrianglesPlane(scale) {
    let HEIGHT;
    let WIDTH;
    this.scaleFactor = scale;
    this.curWidth = WIDTH = HEIGHT = Math.round(this.scaleFactor * constants.VIEWPORT_WIDTH);
    const canvas = $("#render-canvas");
    canvas.width((2 * WIDTH) + 20);
    canvas.height((2 * HEIGHT) + 20);

    $("#TDViewControls button").outerWidth((this.curWidth / 4) - 0.5);

    $(".inputcatcher")
      .css({
        width: WIDTH,
        height: HEIGHT,
      });

    this.resizeThrottled();
  }


  setActiveViewport(viewportID) {
    for (let i = 0; i <= 3; i++) {
      if (i === viewportID) {
        $(".inputcatcher").eq(i).removeClass("inactive").addClass("active");
      } else {
        $(".inputcatcher").eq(i).removeClass("active").addClass("inactive");
      }
    }

    this.draw();
  }


  getCameras() {
    return this.camera;
  }


  showBranchModalDouble(callback) {
    modal.show("You didn't add a node after jumping to this branchpoint, do you really want to jump again?",
      "Jump again?",
      [{ id: "jump-button", label: "Jump again", callback },
       { id: "cancel-button", label: "Cancel" }]);
  }


  showBranchModalDelete(callback) {
    modal.show("You are about to delete an unused branchpoint, are you sure?",
      "Delete branchpoint?",
      [{ id: "delete-button", label: "Delete branchpoint", callback },
       { id: "cancel-button", label: "Cancel" }]);
  }


  bindToEvents() {
    if (this.model.skeletonTracing) {
      this.listenTo(this.model.skeletonTracing, "doubleBranch", this.showBranchModalDouble);
      this.listenTo(this.model.skeletonTracing, "deleteBranch", this.showBranchModalDelete);
      this.listenTo(this.model.skeletonTracing, "mergeDifferentTrees", () => Toast.error("You can't merge nodes within the same tree", false));
    }

    Store.subscribe(() => {
      if (this.running) {
        this.scaleTrianglesPlane(Store.getState().userConfiguration.scale);
      }
    });
  }


  stop() {
    $(".inputcatcher").hide();

    this.running = false;
  }


  start() {
    this.running = true;

    $(".inputcatcher").show();
    this.scaleTrianglesPlane(Store.getState().userConfiguration.scale);

    this.animate();
  }
}

export default PlaneView;
