/**
 * arbitrary_view.js
 * @flow
 */
import $ from "jquery";
import _ from "lodash";
import Backbone from "backbone";
import * as THREE from "three";
import TWEEN from "tween.js";
import scaleInfo from "oxalis/model/scaleinfo";
import Constants from "../constants";
import Flycam3d from "../model/flycam3d";
import View from "../view";


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


  forceUpdate: boolean = false;
  additionalInfo: string = "";
  isRunning: boolean = true;
  animationRequestId: number = 0;

  width: number;
  height: number;
  deviceScaleFactor: number;
  scaleFactor: number;
  camDistance: number;

  scene: THREE.Scene = null;
  camera: THREE.PerspectiveCamera = null;
  renderer: THREE.WebGLRenderer;
  geometries: Array<THREE.Geometry> = [];
  group: THREE.Object3D;
  dataCam: Flycam3d;
  cameraPosition: Array<number>;
  container: JQuery;
  view: View;

  constructor(canvas: JQuery, dataCam: Flycam3d, view: View, width: number) {
    this.animate = this.animateImpl.bind(this);
    this.resize = this.resizeImpl.bind(this);
    this.applyScale = this.applyScaleImpl.bind(this);
    this.setClippingDistance = this.setClippingDistanceImpl.bind(this);
    this.dataCam = dataCam;
    this.view = view;
    _.extend(this, Backbone.Events);

    // camDistance has to be calculates such that with cam
    // angle 45°, the plane of width 128 fits exactly in the
    // viewport.
    this.camDistance = width / 2 / Math.tan(((Math.PI / 180) * 45) / 2);

    // The "render" div serves as a container for the canvas, that is
    // attached to it once a renderer has been initalized.
    this.container = $(canvas);
    this.width = this.container.width();
    this.height = this.container.height();

    this.renderer = this.view.renderer;
    this.scene = this.view.scene;

    // Initialize main THREE.js components

    this.camera = new THREE.PerspectiveCamera(45, this.width / this.height, 50, 1000);
    this.camera.matrixAutoUpdate = false;
    this.camera.aspect = this.width / this.height;

    this.cameraPosition = [0, 0, this.camDistance];

    this.group = new THREE.Object3D();
    // The dimension(s) with the highest resolution will not be distorted
    this.group.scale.copy(new THREE.Vector3(...scaleInfo.nmPerVoxel));
    // Add scene to the group, all Geometries are then added to group
    this.scene.add(this.group);
    this.group.add(this.camera);
  }


  start(): void {
    if (!this.isRunning) {
      this.isRunning = true;

      for (const element of this.group.children) {
        element.setVisibility = element.setVisibility || function (v) { this.visible = v; };
        element.setVisibility(true);
      }

      $(".skeleton-arbitrary-controls").show();
      $("#arbitrary-info-canvas").show();

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
      if (this.animationRequestId !== 0) {
        window.cancelAnimationFrame(this.animationRequestId);
        this.animationRequestId = 0;
      }

      for (const element of this.group.children) {
        element.setVisibility = element.setVisibility || function (v) { this.visible = v; };
        element.setVisibility(false);
      }

      $(window).off("resize", this.resize);

      $(".skeleton-arbitrary-controls").hide();
      $("#arbitrary-info-canvas").hide();
    }
  }


  animateImpl(): void {
    this.animationRequestId = 0;
    if (!this.isRunning) { return; }

    TWEEN.update();

    this.trigger("render", this.forceUpdate);

    const { camera, geometries, renderer, scene } = this;

    for (const geometry of geometries) {
      if (geometry.update != null) {
        geometry.update();
      }
    }

    const m = this.dataCam.getZoomedMatrix();

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

    this.forceUpdate = false;

    this.animationRequestId = window.requestAnimationFrame(this.animate);
  }


  draw(): void {
    this.forceUpdate = true;
  }


  addGeometry(geometry: THREE.Geometry): void {
    // Adds a new Three.js geometry to the scene.
    // This provides the public interface to the GeometryFactory.

    this.geometries.push(geometry);
    geometry.attachScene(this.group);
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

    this.renderer.setSize(this.width, this.height);

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
