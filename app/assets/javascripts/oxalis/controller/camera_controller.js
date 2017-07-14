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
import Store from "oxalis/store";
import { voxelToNm, getBaseVoxel } from "oxalis/model/scaleinfo";
import Dimensions from "oxalis/model/dimensions";
import constants, { OrthoViews, OrthoViewValuesWithoutTDView } from "oxalis/constants";
import type { Vector3, OrthoViewMapType, OrthoViewType } from "oxalis/constants";
import Model from "oxalis/model";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import type { CameraData } from "oxalis/store";
import { setTDCameraAction } from "oxalis/model/actions/view_mode_actions";

type TweenState = {
  upX: number,
  upY: number,
  upZ: number,
  dx: number,
  dy: number,
  dz: number,
  l: number,
  r: number,
  t: number,
  b: number,
};

class CameraController {
  cameras: OrthoViewMapType<THREE.OrthographicCamera>;

  // Copied from backbone events (TODO: handle this better)
  trigger: Function;

  constructor(cameras: OrthoViewMapType<THREE.OrthographicCamera>) {
    _.extend(this, Backbone.Events);
    this.cameras = cameras;

    for (const cam of _.values(this.cameras)) {
      cam.near = -1000000;
      cam.far = 1000000;
    }

    Store.dispatch(setTDCameraAction({
      near: -1000000,
      far: 1000000,
    }));

    this.bindToEvents();  
    this.changeTDViewDiagonal(false);    
  }

  // Non-TD-View methods

  updateCamViewport(): void {
    const state = Store.getState();
    const clippingDistance = state.userConfiguration.clippingDistance;
    const scaleFactor = getBaseVoxel(state.dataset.scale);
    const zoom = state.flycam.zoomStep;
    const boundary = (constants.VIEWPORT_WIDTH / 2) * zoom;
    for (const planeId of OrthoViewValuesWithoutTDView) {
      this.cameras[planeId].near = -clippingDistance;
      this.cameras[planeId].left = this.cameras[planeId].bottom = -boundary * scaleFactor;
      this.cameras[planeId].right = this.cameras[planeId].top = boundary * scaleFactor;
      this.cameras[planeId].updateProjectionMatrix();
    }
    app.vent.trigger("rerender");
  }

  update(): void {
    const state = Store.getState();
    const gPos = getPosition(state.flycam);
    // camera position's unit is nm, so convert it.
    const cPos = voxelToNm(state.dataset.scale, gPos);
    this.cameras[OrthoViews.PLANE_XY].position.copy(new THREE.Vector3(cPos[0], cPos[1], cPos[2]));
    this.cameras[OrthoViews.PLANE_YZ].position.copy(new THREE.Vector3(cPos[0], cPos[1], cPos[2]));
    this.cameras[OrthoViews.PLANE_XZ].position.copy(new THREE.Vector3(cPos[0], cPos[1], cPos[2]));
  };


  bindToEvents() {
    // Use connect() once this is a react controller
    listenToStoreProperty(
      storeState => storeState.userConfiguration.clippingDistance,
      () => this.updateCamViewport(),
      true,
    );
    listenToStoreProperty(
      storeState => storeState.flycam.zoomStep,
      () => this.updateCamViewport(),
    );
    listenToStoreProperty(
      storeState => storeState.flycam.currentMatrix,
      () => this.update(),
    );
    listenToStoreProperty(
      storeState => storeState.viewModeData.plane.tdCamera,
      (cameraData) => this.updateTDCamera(cameraData),
      true,
    );
  }

  // TD-View methods

  changeTDView(id: OrthoViewType, animate: boolean = true): void {
    const camera = this.cameras[OrthoViews.TDView];
    const state = Store.getState();
    const b = voxelToNm(state.dataset.scale, Model.upperBoundary);
    const pos = voxelToNm(state.dataset.scale, getPosition(state.flycam));

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

      to = {
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
      const from = {
        upX: camera.up.x,
        upY: camera.up.y,
        upZ: camera.up.z,
        dx: camera.position.x - pos[0],
        dy: camera.position.y - pos[1],
        dz: camera.position.z - pos[2],
        l: camera.left,
        r: camera.right,
        t: camera.top,
        b: camera.bottom,
      };
      const tween = new TWEEN.Tween(from);

      const _this = this;
      const time = 800;

      tween.to(to, time)
        .onUpdate(function updater() {
          // TweenJS passes the current state via the `this` object.
          // However, for easier type checking, we pass it as an explicit
          // parameter.
          _this.updateCameraTDView(this);
        })
        .start();
    } else {
      this.updateCameraTDView(to);
    }
  }

  changeTDViewXY = (): void => this.changeTDView(OrthoViews.PLANE_XY);
  changeTDViewYZ = (): void => this.changeTDView(OrthoViews.PLANE_YZ);
  changeTDViewXZ = (): void => this.changeTDView(OrthoViews.PLANE_XZ);

  changeTDViewDiagonal = (animate: boolean = true): void => {
    this.changeTDView(OrthoViews.TDView, animate);
  };


  updateTDCamera(cameraData: CameraData): void {
    const tdCamera = this.cameras[OrthoViews.TDView];

    tdCamera.position.set(...cameraData.position);
    tdCamera.left = cameraData.left;
    tdCamera.right = cameraData.right;
    tdCamera.top = cameraData.top;
    tdCamera.bottom = cameraData.bottom;
    tdCamera.up = new THREE.Vector3(...cameraData.up);
    tdCamera.lookAt(new THREE.Vector3(...cameraData.lookAt));

    tdCamera.updateProjectionMatrix();
    
    this.trigger("cameraPositionChanged")
    // app.vent.trigger("rerender");
  }

  updateCameraTDView(tweenState: TweenState): void {
    const p = voxelToNm(Store.getState().dataset.scale, getPosition(Store.getState().flycam));
    const { near, far } = Store.getState().viewModeData.plane.tdCamera;;

    Store.dispatch(setTDCameraAction({
      position: [tweenState.dx + p[0], tweenState.dy + p[1], tweenState.dz + p[2]],
      left: tweenState.l,
      right: tweenState.r,
      top: tweenState.t,
      bottom: tweenState.b,
      up: [tweenState.upX, tweenState.upY, tweenState.upZ],
      lookAt: p,
      near,
      far,
    }));
  }

  TDViewportSize(): number {
    // always quadratic
    return (this.cameras[OrthoViews.TDView].right - this.cameras[OrthoViews.TDView].left);
  }


  zoomTDView = (value: number, targetPosition: THREE.Vector3, curWidth: number): void => {
    let offsetX;
    let offsetY;
    const camera = this.cameras[OrthoViews.TDView];
    const factor = Math.pow(0.9, value);
    const middleX = (camera.left + camera.right) / 2;
    const middleY = (camera.bottom + camera.top) / 2;
    const size = this.TDViewportSize();

    const baseOffset = (factor * size) / 2;
    const baseDiff = baseOffset - (size / 2);

    if (targetPosition != null) {
      offsetX = (((targetPosition.x / curWidth) * 2) - 1) * (-baseDiff);
      offsetY = (((targetPosition.y / curWidth) * 2) - 1) * (+baseDiff);
    } else {
      offsetX = offsetY = 0;
    }

    const { position, up, near, far, lookAt } = Store.getState().viewModeData.plane.tdCamera;
    Store.dispatch(setTDCameraAction({
      left: (middleX - baseOffset) + offsetX,
      right: middleX + baseOffset + offsetX,
      top: middleY + baseOffset + offsetY,
      bottom: (middleY - baseOffset) + offsetY,
      position,
      up,
      lookAt,
      near,
      far,
    }));
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

    Store.dispatch(setTDCameraAction({
      left: camera.left + moveVector.x,
      right: camera.right + moveVector.x,
      top: camera.top + moveVector.y,
      bottom: camera.bottom + moveVector.y,
    }));
  }


  centerTDView(): void {
    const camera = this.cameras[OrthoViews.TDView];
    return this.moveTDViewRaw(
      new THREE.Vector2(
        -(camera.left + camera.right) / 2,
        -(camera.top + camera.bottom) / 2),
    );
  }
}

export default CameraController;
