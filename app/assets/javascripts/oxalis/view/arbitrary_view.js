/**
 * arbitrary_view.js
 * @flow
 */
import BackboneEvents from "backbone-events-standalone";
import * as THREE from "three";
import TWEEN from "tween.js";
import _ from "lodash";

import { getDesiredLayoutRect } from "oxalis/view/layouting/golden_layout_adapter";
import { getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import { getZoomedMatrix } from "oxalis/model/accessors/flycam_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import Constants, { ArbitraryViewport } from "oxalis/constants";
import SceneController from "oxalis/controller/scene_controller";
import Store from "oxalis/store";
import app from "app";
import window from "libs/window";

import { clearCanvas, setupRenderArea } from "./plane_view";

class ArbitraryView {
  // Copied form backbone events (TODO: handle this better)
  trigger: Function;
  unbindChangedScaleListener: () => void;

  animate: () => void;
  setClippingDistance: (value: number) => void;

  needsRerender: boolean;
  additionalInfo: string = "";
  isRunning: boolean = false;
  animationRequestId: ?number = null;

  scaleFactor: number;
  camDistance: number;

  camera: THREE.PerspectiveCamera = null;
  geometries: Array<THREE.Geometry> = [];
  group: THREE.Object3D;
  cameraPosition: Array<number>;

  constructor() {
    this.animate = this.animateImpl.bind(this);
    this.setClippingDistance = this.setClippingDistanceImpl.bind(this);
    _.extend(this, BackboneEvents);

    // camDistance has to be calculated such that with cam
    // angle 45°, the plane of width Constants.VIEWPORT_WIDTH fits exactly in the
    // viewport.
    this.camDistance = Constants.VIEWPORT_WIDTH / 2 / Math.tan(((Math.PI / 180) * 45) / 2);

    // Initialize main THREE.js components
    this.camera = new THREE.PerspectiveCamera(45, 1, 50, 1000);
    this.camera.matrixAutoUpdate = false;

    this.cameraPosition = [0, 0, this.camDistance];

    this.needsRerender = true;
    app.vent.on("rerender", () => {
      this.needsRerender = true;
    });
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

      this.resizeImpl();

      // start the rendering loop
      this.animationRequestId = window.requestAnimationFrame(this.animate);
      // Dont forget to handle window resizing!
      window.addEventListener("resize", this.resizeThrottled);
      this.unbindChangedScaleListener = listenToStoreProperty(
        store => store.userConfiguration.layoutScaleValue,
        this.resizeThrottled,
        true,
      );
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

      window.removeEventListener("resize", this.resizeThrottled);
      this.unbindChangedScaleListener();
    }
  }

  animateImpl(): void {
    this.animationRequestId = null;
    if (!this.isRunning) {
      return;
    }

    TWEEN.update();

    if (this.needsRerender || window.needsRerender) {
      this.trigger("render");

      const { camera, geometries } = this;
      const { renderer, scene } = SceneController;

      for (const geometry of geometries) {
        if (geometry.update != null) {
          geometry.update();
        }
      }

      const m = getZoomedMatrix(Store.getState().flycam);

      camera.matrix.set(
        m[0],
        m[4],
        m[8],
        m[12],
        m[1],
        m[5],
        m[9],
        m[13],
        m[2],
        m[6],
        m[10],
        m[14],
        m[3],
        m[7],
        m[11],
        m[15],
      );

      camera.matrix.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
      camera.matrix.multiply(new THREE.Matrix4().makeTranslation(...this.cameraPosition));
      camera.matrixWorldNeedsUpdate = true;

      clearCanvas(renderer);

      const { left, top, width, height } = getInputCatcherRect(ArbitraryViewport);
      if (width > 0 && height > 0) {
        setupRenderArea(renderer, left, top, Math.min(width, height), width, height, 0xffffff);
        renderer.render(scene, camera);
      }

      this.needsRerender = false;
      window.needsRerender = false;
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

  resizeImpl = (): void => {
    // Call this after the canvas was resized to fix the viewport
    const { width, height } = getDesiredLayoutRect();
    SceneController.renderer.setSize(width, height);
    this.draw();
  };

  // throttle resize to avoid annoying flickering
  resizeThrottled = _.throttle(this.resizeImpl, Constants.RESIZE_THROTTLE_TIME);

  setClippingDistanceImpl(value: number): void {
    this.camera.near = this.camDistance - value;
    this.camera.updateProjectionMatrix();
  }

  setAdditionalInfo(info: string): void {
    this.additionalInfo = info;
  }
}

export default ArbitraryView;
