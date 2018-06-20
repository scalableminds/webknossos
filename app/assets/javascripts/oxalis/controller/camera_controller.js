/**
 * camera_controller.js
 * @flow
 */

import * as THREE from "three";
import * as React from "react";
import _ from "lodash";
import api from "oxalis/api/internal_api";
import constants, { OrthoViews, OrthoViewValuesWithoutTDView } from "oxalis/constants";
import Dimensions from "oxalis/model/dimensions";
import Store from "oxalis/store";
import TWEEN from "tween.js";
import type { CameraData } from "oxalis/store";
import type { Vector3, OrthoViewMapType, OrthoViewType } from "oxalis/constants";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import { getBoundaries } from "oxalis/model/accessors/dataset_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { setTDCameraAction } from "oxalis/model/actions/view_mode_actions";
import { voxelToNm, getBaseVoxel } from "oxalis/model/scaleinfo";

type Props = {
  cameras: OrthoViewMapType<THREE.OrthographicCamera>,
  onCameraPositionChanged: () => void,
};

class CameraController extends React.PureComponent<Props> {
  storePropertyUnsubscribers: Array<Function>;

  componentDidMount() {
    for (const cam of _.values(this.props.cameras)) {
      cam.near = -1000000;
      cam.far = 1000000;
    }

    Store.dispatch(
      setTDCameraAction({
        near: -1000000,
        far: 1000000,
      }),
    );

    this.bindToEvents();
    api.tracing.rotate3DViewToDiagonal(false);
  }

  componentWillUnmount() {
    this.storePropertyUnsubscribers.forEach(fn => fn());
  }

  // Non-TD-View methods

  updateCamViewport(): void {
    const state = Store.getState();
    const clippingDistance = state.userConfiguration.clippingDistance;
    const scaleFactor = getBaseVoxel(state.dataset.dataSource.scale);
    const zoom = state.flycam.zoomStep;
    const halfBoundary = constants.VIEWPORT_WIDTH / 2 * zoom;
    for (const planeId of OrthoViewValuesWithoutTDView) {
      this.props.cameras[planeId].near = -clippingDistance;
      const scaledBoundary = halfBoundary * scaleFactor;
      this.props.cameras[planeId].left = -scaledBoundary;
      this.props.cameras[planeId].bottom = -scaledBoundary;
      this.props.cameras[planeId].right = scaledBoundary;
      this.props.cameras[planeId].top = scaledBoundary;
      this.props.cameras[planeId].updateProjectionMatrix();
    }
  }

  update(): void {
    const state = Store.getState();
    const gPos = getPosition(state.flycam);
    // camera position's unit is nm, so convert it.
    const cPos = voxelToNm(state.dataset.dataSource.scale, gPos);
    const cPosVec = new THREE.Vector3(cPos[0], cPos[1], cPos[2]);
    this.props.cameras[OrthoViews.PLANE_XY].position.copy(cPosVec);
    this.props.cameras[OrthoViews.PLANE_YZ].position.copy(cPosVec);
    this.props.cameras[OrthoViews.PLANE_XZ].position.copy(cPosVec);
  }

  bindToEvents() {
    this.storePropertyUnsubscribers = [
      listenToStoreProperty(
        storeState => storeState.userConfiguration.clippingDistance,
        () => this.updateCamViewport(),
        true,
      ),
      listenToStoreProperty(
        storeState => storeState.flycam.zoomStep,
        () => this.updateCamViewport(),
      ),
      listenToStoreProperty(
        storeState => storeState.flycam.currentMatrix,
        () => this.update(),
        true,
      ),
      listenToStoreProperty(
        storeState => storeState.viewModeData.plane.tdCamera,
        cameraData => this.updateTDCamera(cameraData),
        true,
      ),
    ];
  }

  // TD-View methods

  updateTDCamera(cameraData: CameraData): void {
    const tdCamera = this.props.cameras[OrthoViews.TDView];

    tdCamera.position.set(...cameraData.position);
    tdCamera.left = cameraData.left;
    tdCamera.right = cameraData.right;
    tdCamera.top = cameraData.top;
    tdCamera.bottom = cameraData.bottom;
    tdCamera.up = new THREE.Vector3(...cameraData.up);
    tdCamera.lookAt(new THREE.Vector3(...cameraData.lookAt));

    tdCamera.updateProjectionMatrix();

    this.props.onCameraPositionChanged();
  }

  render() {
    return null;
  }
}

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

export function rotate3DViewTo(id: OrthoViewType, animate: boolean = true): void {
  const state = Store.getState();
  const { dataset } = state;
  const b = voxelToNm(dataset.dataSource.scale, getBoundaries(dataset).upperBoundary);
  const pos = voxelToNm(dataset.dataSource.scale, getPosition(state.flycam));

  let to: TweenState;
  if (id === OrthoViews.TDView) {
    const diagonal = Math.sqrt(b[0] * b[0] + b[1] * b[1]);
    const padding = 0.05 * diagonal;

    // Calculate the distance from (0, b[1]) in order to center the view
    const a1 = b[0];
    const b1 = -b[1];
    const x1 = 0;
    const y1 = b[1];
    const x2 = pos[0];
    const y2 = pos[1];

    const b2 = 1 / Math.sqrt(b1 * b1 / a1 / a1 + 1);
    const a2 = -b2 * b1 / a1;
    const d2 = (a1 / b1 * (y1 - y2) - x1 + x2) / (-a2 + a1 * b2 / b1);

    const intersect = [x2 + d2 * a2, y2 + d2 * b2];
    const distance = Dimensions.distance([x1, y1], intersect);

    // Approximation to center the view vertically
    const yOffset = pos[2] - b[2] / 2;

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
      r: diagonal - distance + padding,
      t: diagonal / 2 + padding + yOffset,
      b: -diagonal / 2 - padding + yOffset,
    };
  } else {
    const ind = Dimensions.getIndices(id);
    const width = Math.max(b[ind[0]], b[ind[1]] * 1.12) * 1.1;
    const paddingTop = width * 0.12;
    const padding = width / 1.1 * 0.1 / 2;
    const offsetX = pos[ind[0]] + padding + (width - b[ind[0]]) / 2;
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

  const updateCameraTDView = function(tweenState: TweenState): void {
    const p = voxelToNm(
      Store.getState().dataset.dataSource.scale,
      getPosition(Store.getState().flycam),
    );

    Store.dispatch(
      setTDCameraAction({
        position: [tweenState.dx + p[0], tweenState.dy + p[1], tweenState.dz + p[2]],
        left: tweenState.l,
        right: tweenState.r,
        top: tweenState.t,
        bottom: tweenState.b,
        up: [tweenState.upX, tweenState.upY, tweenState.upZ],
        lookAt: p,
      }),
    );
  };

  if (animate) {
    const camera = state.viewModeData.plane.tdCamera;

    const from = {
      upX: camera.up[0],
      upY: camera.up[1],
      upZ: camera.up[2],
      dx: camera.position[0] - pos[0],
      dy: camera.position[1] - pos[1],
      dz: camera.position[2] - pos[2],
      l: camera.left,
      r: camera.right,
      t: camera.top,
      b: camera.bottom,
    };
    const tween = new TWEEN.Tween(from);

    const time = 800;

    tween
      .to(to, time)
      .onUpdate(function updater() {
        // TweenJS passes the current state via the `this` object.
        // However, for easier type checking, we pass it as an explicit
        // parameter.
        updateCameraTDView(this);
      })
      .start();
  } else {
    updateCameraTDView(to);
  }
}

export default CameraController;
