/**
 * camera_controller.js
 * @flow
 */

import _ from "lodash";
import app from "app";
import Backbone from "backbone";
import * as THREE from "three";
import TWEEN from "tween.js";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import type { OxalisModel } from "oxalis/model";
import Store from "oxalis/store";
import { voxelToNm, getBaseVoxel } from "oxalis/model/scaleinfo";
import Dimensions from "oxalis/model/dimensions";
import constants, { OrthoViews, OrthoViewValuesWithoutTDView } from "oxalis/constants";
import type { Vector3, OrthoViewMapType, OrthoViewType } from "oxalis/constants";

type TweenState = {
  notify: () => void,
  getConvertedPosition: () => Vector3,
  upX: number,
  upY: number,
  upZ: number,
  camera: THREE.OrthographicCamera,
  dx: number,
  dy: number,
  dz: number,
  l: number,
  r: number,
  t: number,
  b: number,
};

class CameraController {
  // The Skeleton View Camera Controller handles the orthographic camera which is looking at the Skeleton
  // View. It provides methods to set a certain View (animated).

  cameras: OrthoViewMapType<THREE.OrthographicCamera>;
  camera: THREE.OrthographicCamera;
  model: OxalisModel
  tween: TWEEN.Tween;
  camDistance: number;

  // Copied from backbone events (TODO: handle this better)
  trigger: Function;
  listenTo: Function;

  constructor(cameras: OrthoViewMapType<THREE.OrthographicCamera>, model: OxalisModel) {
    _.extend(this, Backbone.Events);
    this.cameras = cameras;
    this.model = model;

    app.vent.on({
      centerTDView: () => this.centerTDView(),
    });

    this.updateCamViewport();
    for (const cam of _.values(this.cameras)) {
      cam.near = -1000000;
      cam.far = 1000000;
    }

    this.changeTDViewDiagonal(false);

    this.bindToEvents();
  }

  update = (): void => {
    const state = Store.getState();
    const gPos = getPosition(state.flycam);
    // camera porition's unit is nm, so convert it.
    const cPos = voxelToNm(state.dataset.scale, gPos);
    this.cameras[OrthoViews.PLANE_XY].position.copy(new THREE.Vector3(cPos[0], cPos[1], cPos[2]));
    this.cameras[OrthoViews.PLANE_YZ].position.copy(new THREE.Vector3(cPos[0], cPos[1], cPos[2]));
    this.cameras[OrthoViews.PLANE_XZ].position.copy(new THREE.Vector3(cPos[0], cPos[1], cPos[2]));
  };


  changeTDView(id: OrthoViewType, animate: boolean = true): void {
    const positionOffset: OrthoViewMapType<Vector3> = {
      [OrthoViews.PLANE_XY]: [0, 0, -1],
      [OrthoViews.PLANE_YZ]: [1, 0, 0],
      [OrthoViews.PLANE_XZ]: [0, 1, 0],
    };
    const upVector: OrthoViewMapType<Vector3> = {
      [OrthoViews.PLANE_XY]: [0, -1, 0],
      [OrthoViews.PLANE_YZ]: [0, -1, 0],
      [OrthoViews.PLANE_XZ]: [0, 0, -1],
    };

    const camera = this.cameras[OrthoViews.TDView];
    const state = Store.getState();
    const b = voxelToNm(state.dataset.scale, this.model.upperBoundary);

    const pos = voxelToNm(state.dataset.scale, getPosition(state.flycam));
    const time = 800;

    const notify = () => this.trigger("cameraPositionChanged");
    const getConvertedPosition = () => voxelToNm(Store.getState().dataset.scale, getPosition(Store.getState().flycam));

    const from = {
      notify,
      getConvertedPosition,
      upX: camera.up.x,
      upY: camera.up.y,
      upZ: camera.up.z,
      camera,
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
    if (id === OrthoViews.TDView) {
      const diagonal = Math.sqrt((b[0] * b[0]) + (b[1] * b[1]));
      const padding = 0.05 * diagonal;

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
      const padding = ((width / 1.1) * 0.1) / 2;
      const offsetX = pos[ind[0]] + padding + ((width - b[ind[0]]) / 2);
      const offsetY = pos[ind[1]] + paddingTop + padding;

      const l = -offsetX;
      const t = offsetY;
      to = {
        camera,
        notify,
        getConvertedPosition,
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

  degToRad(deg: number): number {
    return (deg / 180) * Math.PI;
  }

  changeTDViewXY = (): void => this.changeTDView(OrthoViews.PLANE_XY);
  changeTDViewYZ = (): void => this.changeTDView(OrthoViews.PLANE_YZ);
  changeTDViewXZ = (): void => this.changeTDView(OrthoViews.PLANE_XZ);

  changeTDViewDiagonal = (animate: boolean = true): void => {
    this.changeTDView(OrthoViews.TDView, animate);
  };

  updateCameraTDView(tweenState: TweenState): void {
    const p = tweenState.getConvertedPosition();
    tweenState.camera.position.set(tweenState.dx + p[0], tweenState.dy + p[1], tweenState.dz + p[2]);
    tweenState.camera.left = tweenState.l;
    tweenState.camera.right = tweenState.r;
    tweenState.camera.top = tweenState.t;
    tweenState.camera.bottom = tweenState.b;
    tweenState.camera.up = new THREE.Vector3(tweenState.upX, tweenState.upY, tweenState.upZ);
    tweenState.camera.lookAt(new THREE.Vector3(p[0], p[1], p[2]));

    tweenState.camera.updateProjectionMatrix();
    tweenState.notify();
    app.vent.trigger("rerender");
  }

  TDViewportSize(): number {
    // always quadratic
    return (this.cameras[OrthoViews.TDView].right - this.cameras[OrthoViews.TDView].left);
  }


  zoomTDView = (value: number, position: THREE.Vector3, curWidth: number): void => {
    let offsetX;
    let offsetY;
    const camera = this.cameras[OrthoViews.TDView];
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

    app.vent.trigger("rerender");
  };


  moveTDViewX = (x: number): void => {
    this.moveTDViewRaw(
      new THREE.Vector2((x * this.TDViewportSize()) / constants.VIEWPORT_WIDTH, 0));
  };


  moveTDViewY = (y: number): void => {
    this.moveTDViewRaw(
      new THREE.Vector2(0, (-y * this.TDViewportSize()) / constants.VIEWPORT_WIDTH));
  };


  moveTDView(nmVector: THREE.Vector3): void {
    // moves camera by the nm vector
    const camera = this.cameras[OrthoViews.TDView];

    const rotation = THREE.Vector3.prototype.multiplyScalar.call(
      camera.rotation.clone(), -1,
    );
    // reverse euler order
    rotation.order = rotation.order.split("").reverse().join("");

    nmVector.applyEuler(rotation);
    this.moveTDViewRaw(nmVector);
  }


  moveTDViewRaw(moveVector: THREE.Vector3): void {
    const camera = this.cameras[OrthoViews.TDView];
    camera.left += moveVector.x;
    camera.right += moveVector.x;
    camera.top += moveVector.y;
    camera.bottom += moveVector.y;
    camera.updateProjectionMatrix();
    app.vent.trigger("rerender");
  }


  centerTDView(): void {
    const camera = this.cameras[OrthoViews.TDView];
    return this.moveTDViewRaw(
      new THREE.Vector2(
        -(camera.left + camera.right) / 2,
        -(camera.top + camera.bottom) / 2),
    );
  }


  setClippingDistance(value: number): void {
    this.camDistance = value; // Plane is shifted so it's <value> to the back and the front
    this.updateCamViewport();
  }


  getClippingDistance(dim: number): number {
    const voxelPerNMVector = Store.getState().dataset.scale;
    return this.camDistance * voxelPerNMVector[dim];
  }


  updateCamViewport(): void {
    const state = Store.getState();
    const scaleFactor = getBaseVoxel(state.dataset.scale);
    const zoom = Store.getState().flycam.zoomStep;
    const boundary = (constants.VIEWPORT_WIDTH / 2) * zoom;
    for (const planeId of OrthoViewValuesWithoutTDView) {
      this.cameras[planeId].near = -this.camDistance;
      this.cameras[planeId].left = this.cameras[planeId].bottom = -boundary * scaleFactor;
      this.cameras[planeId].right = this.cameras[planeId].top = boundary * scaleFactor;
      this.cameras[planeId].updateProjectionMatrix();
    }
    app.vent.trigger("rerender");
  }


  bindToEvents() {
    Store.subscribe(() => {
      this.setClippingDistance(Store.getState().userConfiguration.clippingDistance);
      this.updateCamViewport();
    });
  }
}

export default CameraController;
