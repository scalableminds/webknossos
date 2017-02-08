import $ from "jquery";
import _ from "lodash";
import app from "app";
import Backbone from "backbone";
import * as THREE from "three";
import TWEEN from "tween.js";
import Constants from "../constants";

class ArbitraryView {
  static initClass() {
    this.prototype.DEFAULT_SCALE = 1.35;
    this.prototype.MAX_SCALE = 3;
    this.prototype.MIN_SCALE = 1;

    this.prototype.forceUpdate = false;
    this.prototype.geometries = [];
    this.prototype.additionalInfo = "";

    this.prototype.isRunning = true;
    this.prototype.animationRequestId = undefined;

    this.prototype.scene = null;
    this.prototype.camera = null;
    this.prototype.cameraPosition = null;
  }

  constructor(canvas, dataCam, view, width) {
    let camera;
    this.animate = this.animate.bind(this);
    this.resize = this.resize.bind(this);
    this.applyScale = this.applyScale.bind(this);
    this.setClippingDistance = this.setClippingDistance.bind(this);
    this.dataCam = dataCam;
    this.view = view;
    _.extend(this, Backbone.Events);

    // CAM_DISTANCE has to be calculates such that with cam
    // angle 45°, the plane of width 128 fits exactly in the
    // viewport.
    this.CAM_DISTANCE = width / 2 / Math.tan(((Math.PI / 180) * 45) / 2);

    // The "render" div serves as a container for the canvas, that is
    // attached to it once a renderer has been initalized.
    this.container = $(canvas);
    this.width = this.container.width();
    this.height = this.container.height();

    this.renderer = this.view.renderer;
    this.scene = this.view.scene;

    // Initialize main THREE.js components

    this.camera = camera = new THREE.PerspectiveCamera(45, this.width / this.height, 50, 1000);
    camera.matrixAutoUpdate = false;
    camera.aspect = this.width / this.height;

    this.cameraPosition = [0, 0, this.CAM_DISTANCE];

    this.group = new THREE.Object3D();
    // The dimension(s) with the highest resolution will not be distorted
    this.group.scale.copy(new THREE.Vector3(...app.scaleInfo.nmPerVoxel));
    // Add scene to the group, all Geometries are then added to group
    this.scene.add(this.group);
    this.group.add(camera);
  }


  start() {
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


  stop() {
    if (this.isRunning) {
      this.isRunning = false;
      if (this.animationRequestId != null) {
        window.cancelAnimationFrame(this.animationRequestId);
        this.animationRequestId = undefined;
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


  animate() {
    this.animationRequestId = undefined;
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


  draw() {
    this.forceUpdate = true;
  }


  addGeometry(geometry) {
    // Adds a new Three.js geometry to the scene.
    // This provides the public interface to the GeometryFactory.

    this.geometries.push(geometry);
    geometry.attachScene(this.group);
  }


  resizeThrottled() {
    // throttle resize to avoid annoying flickering

    this.resizeThrottled = _.throttle(
      () => this.resize(),
      Constants.RESIZE_THROTTLE_TIME,
    );
    this.resizeThrottled();
  }


  resize() {
    // Call this after the canvas was resized to fix the viewport
    // Needs to be bound

    this.width = this.container.width();
    this.height = this.container.height();

    this.renderer.setSize(this.width, this.height);

    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.draw();
  }


  applyScale(delta) {
    if (!this.scaleFactor) { this.scaleFactor = this.DEFAULT_SCALE; }

    if ((this.scaleFactor + delta > this.MIN_SCALE) && (this.scaleFactor + delta < this.MAX_SCALE)) {
      this.scaleFactor += Number(delta);
      this.width = this.height = this.scaleFactor * Constants.VIEWPORT_WIDTH;
      this.container.width(this.width);
      this.container.height(this.height);

      this.resizeThrottled();
    }
  }

  setClippingDistance(value) {
    this.camera.near = this.CAM_DISTANCE - value;
    this.camera.updateProjectionMatrix();
  }


  setAdditionalInfo(info) {
    this.additionalInfo = info;
  }
}
ArbitraryView.initClass();

export default ArbitraryView;
