/**
 * arbitrary_view.js
 * @flow
 */
import $ from "jquery";
import _ from "lodash";
import app from "app";
import Backbone from "backbone";
import * as THREE from "three";
import TWEEN from "tween.js";
import Constants from "oxalis/constants";
import Store from "oxalis/store";
import SceneController from "oxalis/controller/scene_controller";
import { getZoomedMatrix } from "oxalis/model/accessors/flycam_accessor";


const DEFAULT_SCALE: number = 1.35;
const MAX_SCALE: number = 3;
const MIN_SCALE: number = 1;

class ArbitraryView {

  // Copied form backbone events (TODO: handle this better)
  trigger: Function;
  on: Function;
  listenTo: Function;

  animate: () => void;
  resize: () => void;
  applyScale: (delta: number) => void;
  setClippingDistance: (value: number) => void;


  needsRerender: boolean;
  additionalInfo: string = "";
  isRunning: boolean = false;
  animationRequestId: ?number = null;

  width: number;
  height: number;
  scaleFactor: number;
  camDistance: number;

  camera: THREE.PerspectiveCamera = null;
  geometries: Array<THREE.Geometry> = [];
  group: THREE.Object3D;
  cameraPosition: Array<number>;
  container: JQuery;

  constructor(canvasSelector: string, width: number) {
    this.animate = this.animateImpl.bind(this);
    this.resize = this.resizeImpl.bind(this);
    this.applyScale = this.applyScaleImpl.bind(this);
    this.setClippingDistance = this.setClippingDistanceImpl.bind(this);
    _.extend(this, Backbone.Events);

    // camDistance has to be calculated such that with cam
    // angle 45°, the plane of width 128 fits exactly in the
    // viewport.
    this.camDistance = width / 2 / Math.tan(((Math.PI / 180) * 45) / 2);

    // The "render" div serves as a container for the canvas, that is
    // attached to it once a renderer has been initalized.
    this.container = $(canvasSelector);
    this.width = this.container.width();
    this.height = this.container.height();

    // Initialize main THREE.js components

    this.camera = new THREE.PerspectiveCamera(45, this.width / this.height, 50, 1000);
    this.camera.matrixAutoUpdate = false;
    this.camera.aspect = this.width / this.height;

    this.cameraPosition = [0, 0, this.camDistance];

    this.needsRerender = true;
    app.vent.on("rerender", () => { this.needsRerender = true; });
    Store.subscribe(() => {
      // Render in the next frame after the change propagated everywhere
      window.requestAnimationFrame(() => {
        this.needsRerender = true;
      });
    });
  }


  start(): void {
    if (!this.isRunning) {
      this.isRunning = true;

      this.group = new THREE.Object3D();
      this.group.add(this.camera);
      SceneController.rootGroup.add(this.group);

      this.resize();
      // start the rendering loop
      this.animationRequestId = window.requestAnimationFrame(this.animate);
      // Dont forget to handle window resizing!
      $(window).on("resize", this.resize);
    }
  }


  stop(): void {
    if (this.isRunning) {
      this.isRunning = false;
      if (this.animationRequestId != null) {
        window.cancelAnimationFrame(this.animationRequestId);
        this.animationRequestId = null;
      }

      SceneController.rootGroup.remove(this.group);

      $(window).off("resize", this.resize);
    }
  }


  animateImpl(): void {
    this.animationRequestId = null;
    if (!this.isRunning) { return; }

    TWEEN.update();

    if (this.needsRerender) {
      this.trigger("render");

      const { camera, geometries } = this;
      const { renderer, scene } = SceneController;

      for (const geometry of geometries) {
        if (geometry.update != null) {
          geometry.update();
        }
      }

      const m = getZoomedMatrix(Store.getState().flycam);

      camera.matrix.set(m[0], m[4], m[8], m[12],
                        m[1], m[5], m[9], m[13],
                        m[2], m[6], m[10], m[14],
                        m[3], m[7], m[11], m[15]);

      camera.matrix.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
      camera.matrix.multiply(new THREE.Matrix4().makeTranslation(...this.cameraPosition));
      camera.matrixWorldNeedsUpdate = true;

      renderer.setViewport(0, 0, this.width, this.height);
      renderer.setScissor(0, 0, this.width, this.height);
      renderer.setScissorTest(true);
      renderer.setClearColor(0xFFFFFF, 1);

      renderer.render(scene, camera);

      this.needsRerender = false;
    }

    this.animationRequestId = window.requestAnimationFrame(this.animate);
  }


  draw(): void {
    this.needsRerender = true;
  }


  addGeometry(geometry: THREE.Geometry): void {
    // Adds a new Three.js geometry to the scene.
    // This provides the public interface to the GeometryFactory.

    this.geometries.push(geometry);
    geometry.addToScene(this.group);
  }

  // throttle resize to avoid annoying flickering
  resizeThrottled = _.throttle(
    () => this.resize(),
    Constants.RESIZE_THROTTLE_TIME,
  );


  resizeImpl(): void {
    // Call this after the canvas was resized to fix the viewport
    // Needs to be bound

    this.width = this.container.width();
    this.height = this.container.height();

    SceneController.renderer.setSize(this.width, this.height);

    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.draw();
  }


  applyScaleImpl(delta: number): void {
    if (!this.scaleFactor) { this.scaleFactor = DEFAULT_SCALE; }

    if ((this.scaleFactor + delta > MIN_SCALE) && (this.scaleFactor + delta < MAX_SCALE)) {
      this.scaleFactor += Number(delta);
      this.width = this.height = this.scaleFactor * Constants.VIEWPORT_WIDTH;
      this.container.width(this.width);
      this.container.height(this.height);

      this.resizeThrottled();
    }
  }

  setClippingDistanceImpl(value: number): void {
    this.camera.near = this.camDistance - value;
    this.camera.updateProjectionMatrix();
  }


  setAdditionalInfo(info: string): void {
    this.additionalInfo = info;
  }
}

export default ArbitraryView;
