/**
 * plane_view.js
 * @flow
 */
import _ from "lodash";
import app from "app";
import Backbone from "backbone";
import $ from "jquery";
import TWEEN from "tween.js";
import scaleInfo from "oxalis/model/scaleinfo";
import * as THREE from "three";
import Store from "oxalis/store";
import constants, { OrthoViews, OrthoViewValues, OrthoViewColors } from "oxalis/constants";
import type { OrthoViewType, OrthoViewMapType, Vector2 } from "oxalis/constants";
import Model from "oxalis/model";
import View from "oxalis/view";

class PlaneView {

  // Copied form backbone events (TODO: handle this better)
  trigger: Function;
  on: Function;
  listenTo: Function;

  model: Model;
  view: View;
  renderer: THREE.WebGLRenderer;
  cameras: OrthoViewMapType<THREE.OrthographicCamera>;
  group: THREE.Object3D;
  scene: THREE.Scene;

  running: boolean;
  needsRerender: boolean;
  curWidth: number;
  deviceScaleFactor: number;
  scaleFactor: number;

  constructor(model: Model, view: View) {
    let HEIGHT;
    let WIDTH;
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
    this.cameras = {};

    for (const plane of OrthoViewValues) {
      // Let's set up cameras
      // No need to set any properties, because the cameras controller will deal with that
      this.cameras[plane] = new THREE.OrthographicCamera(0, 0, 0, 0);
      this.scene.add(this.cameras[plane]);
    }


    this.cameras[OrthoViews.PLANE_XY].position.z = -1;
    this.cameras[OrthoViews.PLANE_YZ].position.x = 1;
    this.cameras[OrthoViews.PLANE_XZ].position.y = 1;
    this.cameras[OrthoViews.TDView].position.copy(new THREE.Vector3(10, 10, -10));
    this.cameras[OrthoViews.PLANE_XY].up = new THREE.Vector3(0, -1, 0);
    this.cameras[OrthoViews.PLANE_YZ].up = new THREE.Vector3(0, -1, 0);
    this.cameras[OrthoViews.PLANE_XZ].up = new THREE.Vector3(0, 0, -1);
    this.cameras[OrthoViews.TDView].up = new THREE.Vector3(0, 0, -1);
    for (const plane of OrthoViewValues) {
      this.cameras[plane].lookAt(new THREE.Vector3(0, 0, 0));
    }

    // Because the voxel coordinates do not have a cube shape but are distorted,
    // we need to distort the entire scene to provide an illustration that is
    // proportional to the actual size in nm.
    // For some reason, all objects have to be put into a group object. Changing
    // scene.scale does not have an effect.
    this.group = new THREE.Object3D();
    // The dimension(s) with the highest resolution will not be distorted
    this.group.scale.copy(scaleInfo.getNmPerVoxelVector());
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

    this.setActiveViewport(OrthoViews.PLANE_XY);

    this.needsRerender = true;
    app.vent.on("rerender", () => { this.needsRerender = true; });

    Store.subscribe(() => {
      if (this.running) {
        this.scaleTrianglesPlane(Store.getState().userConfiguration.scale);
      }
    });
  }


  animate(): void {
    if (!this.running) { return; }

    this.renderFunction();

    window.requestAnimationFrame(() => this.animate());
  }

  renderFunction(): void {
    // This is the main render function.
    // All 3D meshes and the trianglesplane are rendered here.

    TWEEN.update();

    // skip rendering if nothing has changed
    // This prevents you the GPU/CPU from constantly
    // working and keeps your lap cool
    // ATTENTION: this limits the FPS to 30 FPS (depending on the keypress update frequence)

    let modelChanged: boolean = false;
    for (const name of Object.keys(this.model.binary)) {
      const binary = this.model.binary[name];
      for (const plane of _.values(binary.planes)) {
        modelChanged = modelChanged || plane.hasChanged();
      }
    }

    if (this.needsRerender || modelChanged) {
      this.trigger("render");

      const viewport: OrthoViewMapType<Vector2> = {
        [OrthoViews.PLANE_XY]: [0, this.curWidth + 20],
        [OrthoViews.PLANE_YZ]: [this.curWidth + 20, this.curWidth + 20],
        [OrthoViews.PLANE_XZ]: [0, 0],
        [OrthoViews.TDView]: [this.curWidth + 20, 0],
      };
      this.renderer.autoClear = true;

      const setupRenderArea = (x, y, width, color) => {
        this.renderer.setViewport(x, y, width, width);
        this.renderer.setScissor(x, y, width, width);
        this.renderer.setScissorTest(true);
        this.renderer.setClearColor(color, 1);
      };

      setupRenderArea(0, 0, this.renderer.domElement.width, 0xffffff);
      this.renderer.clear();

      for (const plane of OrthoViewValues) {
        this.trigger("renderCam", plane);
        setupRenderArea(
          viewport[plane][0],
          viewport[plane][1],
          this.curWidth,
          OrthoViewColors[plane],
        );
        this.renderer.render(this.scene, this.cameras[plane]);
      }

      this.needsRerender = false;
    }
  }

  addGeometry(geometry: THREE.Geometry): void {
    // Adds a new Three.js geometry to the scene.
    // This provides the public interface to the GeometryFactory.

    this.group.add(geometry);
  }


  removeGeometry(geometry: THREE.Geometry): void {
    this.group.remove(geometry);
    this.draw();
  }


  draw(): void {
    app.vent.trigger("rerender");
  }


  resizeThrottled = _.throttle((): void => {
    // throttle resize to avoid annoying flickering
    this.resize();
    app.vent.trigger("planes:resize");
  }, constants.RESIZE_THROTTLE_TIME);


  resize = (): void => {
    // Call this after the canvas was resized to fix the viewport
    const canvas = $("#render-canvas");
    const WIDTH = (canvas.width() - 20) / 2;
    const HEIGHT = (canvas.height() - 20) / 2;

    this.renderer.setSize((2 * WIDTH) + 20, (2 * HEIGHT) + 20);
    for (const plane of OrthoViewValues) {
      this.cameras[plane].aspect = WIDTH / HEIGHT;
      this.cameras[plane].updateProjectionMatrix();
    }
    this.draw();
  };


  scaleTrianglesPlane = (scale: number): void => {
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
  };


  setActiveViewport = (viewportID: OrthoViewType): void => {
    for (const plane of OrthoViewValues) {
      if (plane === viewportID) {
        $(`#inputcatcher_${plane}`).removeClass("inactive").addClass("active");
      } else {
        $(`#inputcatcher_${plane}`).removeClass("active").addClass("inactive");
      }
    }

    this.draw();
  };


  getCameras(): OrthoViewMapType<THREE.OrthographicCamera> {
    return this.cameras;
  }


  stop(): void {
    $(".inputcatcher").hide();

    this.running = false;
  }


  start(): void {
    this.running = true;

    $(".inputcatcher").show();
    this.scaleTrianglesPlane(Store.getState().userConfiguration.scale);

    this.animate();
  }
}

export default PlaneView;
