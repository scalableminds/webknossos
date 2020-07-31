/**
 * camera_controller.js
 * @flow
 */

import * as React from "react";
import * as THREE from "three";
import TWEEN from "tween.js";
import _ from "lodash";

import {
  type OrthoView,
  type OrthoViewMap,
  type OrthoViewRects,
  OrthoViewValuesWithoutTDView,
  OrthoViews,
  type Vector3,
} from "oxalis/constants";
import { getBoundaries } from "oxalis/model/accessors/dataset_accessor";
import { getInputCatcherAspectRatio } from "oxalis/model/accessors/view_mode_accessor";
import {
  getPlaneExtentInVoxelFromStore,
  getPosition,
} from "oxalis/model/accessors/flycam_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { setTDCameraAction } from "oxalis/model/actions/view_mode_actions";
import { voxelToNm, getBaseVoxel } from "oxalis/model/scaleinfo";
import Dimensions from "oxalis/model/dimensions";
import Store, { type CameraData } from "oxalis/store";
import api from "oxalis/api/internal_api";

type Props = {
  cameras: OrthoViewMap<THREE.OrthographicCamera>,
  onCameraPositionChanged: () => void,
};

class CameraController extends React.PureComponent<Props> {
  storePropertyUnsubscribers: Array<Function>;

  componentDidMount() {
    const far = 8000000;
    for (const cam of _.values(this.props.cameras)) {
      cam.near = 0;
      cam.far = far;
    }

    Store.dispatch(
      setTDCameraAction({
        near: 0,
        far,
      }),
    );

    this.bindToEvents();
    api.tracing.rotate3DViewToDiagonal(false);
  }

  componentWillUnmount() {
    this.storePropertyUnsubscribers.forEach(fn => fn());
  }

  // Non-TD-View methods

  updateCamViewport(inputCatcherRects?: OrthoViewRects): void {
    const state = Store.getState();
    const { clippingDistance } = state.userConfiguration;
    const scaleFactor = getBaseVoxel(state.dataset.dataSource.scale);
    for (const planeId of OrthoViewValuesWithoutTDView) {
      const [width, height] = getPlaneExtentInVoxelFromStore(
        state,
        state.flycam.zoomStep,
        planeId,
      ).map(x => x * scaleFactor);

      this.props.cameras[planeId].left = -width / 2;
      this.props.cameras[planeId].right = width / 2;

      this.props.cameras[planeId].bottom = -height / 2;
      this.props.cameras[planeId].top = height / 2;

      this.props.cameras[planeId].near = -clippingDistance;
      this.props.cameras[planeId].updateProjectionMatrix();
    }

    if (inputCatcherRects != null) {
      // Update td camera's aspect ratio
      const tdCamera = this.props.cameras[OrthoViews.TDView];

      const oldMid = (tdCamera.right + tdCamera.left) / 2;
      const oldWidth = tdCamera.right - tdCamera.left;
      const oldHeight = tdCamera.top - tdCamera.bottom;

      const oldAspectRatio = oldWidth / oldHeight;
      const tdRect = inputCatcherRects[OrthoViews.TDView];
      const newAspectRatio = tdRect.width / tdRect.height;

      // Do not update the tdCamera if the tdView is not visible (height === 0)
      if (Number.isNaN(newAspectRatio)) return;

      const newWidth = (oldWidth * newAspectRatio) / oldAspectRatio;

      tdCamera.left = oldMid - newWidth / 2;
      tdCamera.right = oldMid + newWidth / 2;
      tdCamera.updateProjectionMatrix();
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
        storeState => storeState.viewModeData.plane.inputCatcherRects,
        inputCatcherRects => this.updateCamViewport(inputCatcherRects),
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

export function rotate3DViewTo(id: OrthoView, animate: boolean = true): void {
  const state = Store.getState();
  const { dataset } = state;
  const { tdCamera } = state.viewModeData.plane;
  const b = voxelToNm(dataset.dataSource.scale, getBoundaries(dataset).upperBoundary);
  const flycamPos = voxelToNm(dataset.dataSource.scale, getPosition(state.flycam));

  const aspectRatio = getInputCatcherAspectRatio(state, OrthoViews.TDView);
  // This distance ensures that the 3D camera is so far "in the back" that all elements in the scene
  // are in front of it and thus visible.
  const clippingOffsetFactor = 900000;

  let to: TweenState;
  if (id === OrthoViews.TDView) {
    const diagonal = Math.sqrt(b[0] * b[0] + b[1] * b[1]);
    const padding = 0.05 * diagonal;

    // Calculate the distance from (0, b[1]) in order to center the view
    const a1 = b[0];
    const b1 = -b[1];
    const x1 = 0;
    const y1 = b[1];
    const x2 = flycamPos[0];
    const y2 = flycamPos[1];

    const b2 = 1 / Math.sqrt((b1 * b1) / a1 / a1 + 1);
    const a2 = (-b2 * b1) / a1;
    const d2 = ((a1 / b1) * (y1 - y2) - x1 + x2) / (-a2 + (a1 * b2) / b1);

    const intersect = [x2 + d2 * a2, y2 + d2 * b2];
    const distance = Dimensions.distance([x1, y1], intersect);

    // Approximation to center the view vertically
    const yOffset = flycamPos[2] - b[2] / 2;

    // Calulate the x coordinate so that the vector from the camera to the cube's middle point is
    // perpendicular to the vector going from (0, b[1], 0) to (b[0], 0, 0).

    const squareLeft = -distance - padding;
    const squareRight = diagonal - distance + padding;
    const squareTop = diagonal / 2 + padding + yOffset;
    const squareBottom = -diagonal / 2 - padding + yOffset;
    const squareCenterX = (squareLeft + squareRight) / 2;
    const squareCenterY = (squareTop + squareBottom) / 2;
    const squareWidth = Math.abs(squareLeft - squareRight);

    const height = squareWidth / aspectRatio;

    to = {
      dx: (b[1] / diagonal) * clippingOffsetFactor,
      dy: (b[0] / diagonal) * clippingOffsetFactor,
      dz: (-1 / 2) * clippingOffsetFactor,
      upX: 0,
      upY: 0,
      upZ: -1,
      l: squareCenterX - squareWidth / 2,
      r: squareCenterX + squareWidth / 2,
      t: squareCenterY + height / 2,
      b: squareCenterY - height / 2,
    };
  } else {
    const width = tdCamera.right - tdCamera.left;
    const height = tdCamera.top - tdCamera.bottom;
    const positionOffset: OrthoViewMap<Vector3> = {
      [OrthoViews.PLANE_XY]: [0, 0, -clippingOffsetFactor],
      [OrthoViews.PLANE_YZ]: [clippingOffsetFactor, 0, 0],
      [OrthoViews.PLANE_XZ]: [0, clippingOffsetFactor, 0],
    };
    const upVector: OrthoViewMap<Vector3> = {
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
      l: -width / 2,
      r: width / 2,
      t: height / 2,
      b: -height / 2,
    };
  }

  const updateCameraTDView = (tweenState: TweenState) => {
    const currentFlycamPos = voxelToNm(
      Store.getState().dataset.dataSource.scale,
      getPosition(Store.getState().flycam),
    );
    Store.dispatch(
      setTDCameraAction({
        position: [
          tweenState.dx + currentFlycamPos[0],
          tweenState.dy + currentFlycamPos[1],
          tweenState.dz + currentFlycamPos[2],
        ],
        left: tweenState.l,
        right: tweenState.r,
        top: tweenState.t,
        bottom: tweenState.b,
        up: [tweenState.upX, tweenState.upY, tweenState.upZ],
        lookAt: currentFlycamPos,
      }),
    );
  };

  if (animate) {
    const from = {
      upX: tdCamera.up[0],
      upY: tdCamera.up[1],
      upZ: tdCamera.up[2],
      dx: tdCamera.position[0] - flycamPos[0],
      dy: tdCamera.position[1] - flycamPos[1],
      dz: tdCamera.position[2] - flycamPos[2],
      l: tdCamera.left,
      r: tdCamera.right,
      t: tdCamera.top,
      b: tdCamera.bottom,
    };
    const tween = new TWEEN.Tween(from);

    const time = 800;

    tween
      .to(to, time)
      .onUpdate(function updater() {
        // TweenJS passes the current state via the `this` object.
        // However, for better type checking, we pass it as an explicit
        // parameter.
        updateCameraTDView(this);
      })
      .start();
  } else {
    updateCameraTDView(to);
  }
}

export default CameraController;
