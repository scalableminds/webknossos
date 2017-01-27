/**
 * camera_controller.js
 * @flow weak
 */

import _ from "lodash";
import app from "app";
import Backbone from "backbone";
import THREE from "three";
import TWEEN from "tween.js";
import Flycam2d from "oxalis/model/flycam2d";
import Model from "oxalis/model";
import type { Vector3 } from "oxalis/constants";
import Dimensions from "../model/dimensions";
import constants from "../constants";

type TweenState = {
  notify: () => void,
  getConvertedPosition: () => Vector3,
  upX: number,
  upY: number,
  upZ: number,
  camera: THREE.OrthographicCamera,
  flycam: Flycam2d,
  dx: number,
  dy: number,
  dz: number,
  l: number,
  r: number,
  t: number,
  b: number,
};

class CameraController {
  // The Sceleton View Camera Controller handles the orthographic camera which is looking at the Skeleton
  // View. It provides methods to set a certain View (animated).

  cameras: Array<THREE.OrthographicCamera>;
  camera: THREE.OrthographicCamera;
  flycam: Flycam2d;
  model: Model;
  tween: TWEEN.Tween;
  camDistance: number;

  // Copied from backbone events (TODO: handle this better)
  trigger: Function;
  listenTo: Function;

  constructor(cameras, flycam, model) {
    this.cameras = cameras;
    this.flycam = flycam;
    this.model = model;
    _.extend(this, Backbone.Events);

    app.vent.on({
      centerTDView: () => this.centerTDView(),
    });

    this.updateCamViewport();
    for (const cam of this.cameras) {
      cam.near = -1000000;
      cam.far = 1000000;
    }

    this.changeTDViewDiagonal(false);

    this.bindToEvents();
  }

  update = () => {
    const gPos = this.flycam.getPosition();
    // camera porition's unit is nm, so convert it.
    const cPos = app.scaleInfo.voxelToNm(gPos);
    this.cameras[constants.PLANE_XY].position = new THREE.Vector3(cPos[0], cPos[1], cPos[2]);
    this.cameras[constants.PLANE_YZ].position = new THREE.Vector3(cPos[0], cPos[1], cPos[2]);
    this.cameras[constants.PLANE_XZ].position = new THREE.Vector3(cPos[0], cPos[1], cPos[2]);
  }


  changeTDView(id, animate = true) {
    let padding;
    const camera = this.cameras[constants.TDView];
    const b = app.scaleInfo.voxelToNm(this.model.upperBoundary);

    const pos = app.scaleInfo.voxelToNm(this.model.flycam.getPosition());
    const time = 800;

    const notify = () => this.trigger("cameraPositionChanged");
    const getConvertedPosition = () => app.scaleInfo.voxelToNm(this.model.flycam.getPosition());

    const from = {
      notify,
      getConvertedPosition,
      upX: camera.up.x,
      upY: camera.up.y,
      upZ: camera.up.z,
      camera,
      flycam: this.flycam,
      dx: camera.position.x - pos[0],
      dy: camera.position.y - pos[1],
      dz: camera.position.z - pos[2],
      l: camera.left,
      r: camera.right,
      t: camera.top,
      b: camera.bottom,
    };
    this.tween = new TWEEN.Tween(from);

    let to: TweenState;
    if (id === constants.TDView) {
      const diagonal = Math.sqrt((b[0] * b[0]) + (b[1] * b[1]));
      padding = 0.05 * diagonal;

      // Calculate the distance from (0, b[1]) in order to center the view
      const a1 = b[0]; const b1 = -b[1]; const x1 = 0; const y1 = b[1];
      const x2 = pos[0]; const y2 = pos[1];

      const b2 = 1 / Math.sqrt(((b1 * b1) / a1 / a1) + 1);
      const a2 = (-b2 * b1) / a1;
      const d2 = ((((a1 / b1) * (y1 - y2)) - x1) + x2) / (-a2 + ((a1 * b2) / b1));

      const intersect = [x2 + (d2 * a2), y2 + (d2 * b2)];
      const distance = Dimensions.distance([x1, y1], intersect);

      // Approximation to center the view vertically
      const yOffset = pos[2] - (b[2] / 2);

      // Calulate the x coordinate so that the vector from the camera to the cube's middle point is
      // perpendicular to the vector going from (0, b[1], 0) to (b[0], 0, 0).

      to = {
        camera,
        notify,
        getConvertedPosition,
        flycam: this.flycam,
        dx: b[1] / diagonal,
        dy: b[0] / diagonal,
        dz: -1 / 2,
        upX: 0,
        upY: 0,
        upZ: -1,
        l: -distance - padding,
        r: (diagonal - distance) + padding,
        t: (diagonal / 2) + padding + yOffset,
        b: ((-diagonal / 2) - padding) + yOffset,
      };
    } else {
      const ind = Dimensions.getIndices(id);
      const width = Math.max(b[ind[0]], b[ind[1]] * 1.12) * 1.1;
      const paddingTop = width * 0.12;
      padding = ((width / 1.1) * 0.1) / 2;
      const offsetX = pos[ind[0]] + padding + ((width - b[ind[0]]) / 2);
      const offsetY = pos[ind[1]] + paddingTop + padding;

      const positionOffset = [[0, 0, -1], [1, 0, 0], [0, 1, 0]];
      const upVector = [[0, -1, 0], [0, -1, 0], [0, 0, -1]];

      const l = -offsetX;
      const t = offsetY;
      to = {
        camera,
        notify,
        getConvertedPosition,
        flycam: this.flycam,
        dx: positionOffset[id][0],
        dy: positionOffset[id][1],
        dz: positionOffset[id][2],
        upX: upVector[id][0],
        upY: upVector[id][1],
        upZ: upVector[id][2],
        l,
        t,
        r: l + width,
        b: t - width,
      };
    }

    if (animate) {
      const _this = this;
      return this.tween.to(to, time)
        .onUpdate(function updater() {
          // TweenJS passes the current state via the `this` object.
          // However, for easier type checking, we pass it as an explicit
          // parameter.
          _this.updateCameraTDView(this);
        })
        .start();
    } else {
      return this.updateCameraTDView(to);
    }
  }

  degToRad(deg) { return (deg / 180) * Math.PI; }

  changeTDViewXY = () => this.changeTDView(constants.PLANE_XY)
  changeTDViewYZ = () => this.changeTDView(constants.PLANE_YZ)
  changeTDViewXZ = () => this.changeTDView(constants.PLANE_XZ)

  changeTDViewDiagonal = (animate) => {
    if (animate == null) {
      animate = true;
    }
    return this.changeTDView(constants.TDView, animate);
  }

  updateCameraTDView(tweenState: TweenState) {
    const p = tweenState.getConvertedPosition();
    tweenState.camera.position.set(tweenState.dx + p[0], tweenState.dy + p[1], tweenState.dz + p[2]);
    tweenState.camera.left = tweenState.l;
    tweenState.camera.right = tweenState.r;
    tweenState.camera.top = tweenState.t;
    tweenState.camera.bottom = tweenState.b;
    tweenState.camera.up = new THREE.Vector3(tweenState.upX, tweenState.upY, tweenState.upZ);

    tweenState.flycam.setRayThreshold(tweenState.camera.right, tweenState.camera.left);
    tweenState.camera.updateProjectionMatrix();
    tweenState.notify();
    app.vent.trigger("rerender");
  }

  TDViewportSize() {
    // always quadratic
    return (this.cameras[constants.TDView].right - this.cameras[constants.TDView].left);
  }


  zoomTDView = (value, position, curWidth) => {
    let offsetX;
    let offsetY;
    const camera = this.cameras[constants.TDView];
    const factor = Math.pow(0.9, value);
    const middleX = (camera.left + camera.right) / 2;
    const middleY = (camera.bottom + camera.top) / 2;
    const size = this.TDViewportSize();

    const baseOffset = (factor * size) / 2;
    const baseDiff = baseOffset - (size / 2);

    if (position != null) {
      offsetX = (((position.x / curWidth) * 2) - 1) * (-baseDiff);
      offsetY = (((position.y / curWidth) * 2) - 1) * (+baseDiff);
    } else {
      offsetX = offsetY = 0;
    }

    camera.left = (middleX - baseOffset) + offsetX;
    camera.right = middleX + baseOffset + offsetX;
    camera.top = middleY + baseOffset + offsetY;
    camera.bottom = (middleY - baseOffset) + offsetY;
    camera.updateProjectionMatrix();

    this.flycam.setRayThreshold(camera.right, camera.left);
    app.vent.trigger("rerender");
  }


  moveTDViewX = x => this.moveTDViewRaw(
    new THREE.Vector2((x * this.TDViewportSize()) / constants.VIEWPORT_WIDTH, 0),
  )


  moveTDViewY = y => this.moveTDViewRaw(
    new THREE.Vector2(0, (-y * this.TDViewportSize()) / constants.VIEWPORT_WIDTH),
  )


  moveTDView(nmVector) {
    // moves camera by the nm vector
    const camera = this.cameras[constants.TDView];

    const rotation = THREE.Vector3.prototype.multiplyScalar.call(
      camera.rotation.clone(), -1,
    );
    // reverse euler order
    rotation.order = rotation.order.split("").reverse().join("");

    nmVector.applyEuler(rotation);
    return this.moveTDViewRaw(nmVector);
  }


  moveTDViewRaw(moveVector) {
    const camera = this.cameras[constants.TDView];
    camera.left += moveVector.x;
    camera.right += moveVector.x;
    camera.top += moveVector.y;
    camera.bottom += moveVector.y;
    camera.updateProjectionMatrix();
    app.vent.trigger("rerender");
  }


  centerTDView() {
    const camera = this.cameras[constants.TDView];
    return this.moveTDViewRaw(
      new THREE.Vector2(
        -(camera.left + camera.right) / 2,
        -(camera.top + camera.bottom) / 2),
    );
  }


  setClippingDistance(value) {
    this.camDistance = value; // Plane is shifted so it's <value> to the back and the front
    return this.updateCamViewport();
  }


  getClippingDistance(planeID) {
    return this.camDistance * app.scaleInfo.voxelPerNM[planeID];
  }


  updateCamViewport() {
    const scaleFactor = app.scaleInfo.baseVoxel;
    const boundary = (constants.VIEWPORT_WIDTH / 2) * this.model.user.get("zoom");
    for (const i of [constants.PLANE_XY, constants.PLANE_YZ, constants.PLANE_XZ]) {
      this.cameras[i].near = -this.camDistance;
      this.cameras[i].left = this.cameras[i].bottom = -boundary * scaleFactor;
      this.cameras[i].right = this.cameras[i].top = boundary * scaleFactor;
      this.cameras[i].updateProjectionMatrix();
    }
    app.vent.trigger("rerender");
  }


  bindToEvents() {
    this.listenTo(this.model.user, "change:clippingDistance", function (model, value) { return this.setClippingDistance(value); });
    this.listenTo(this.model.user, "change:zoom", function () { return this.updateCamViewport(); });
  }
}

export default CameraController;
