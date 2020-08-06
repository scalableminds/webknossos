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
import {
  getDatasetExtentInLength,
  getDatasetCenter,
} from "oxalis/model/accessors/dataset_accessor";
import { getInputCatcherAspectRatio } from "oxalis/model/accessors/view_mode_accessor";
import {
  getPlaneExtentInVoxelFromStore,
  getPosition,
} from "oxalis/model/accessors/flycam_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { setTDCameraAction } from "oxalis/model/actions/view_mode_actions";
import { voxelToNm, getBaseVoxel } from "oxalis/model/scaleinfo";
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

    updateCamera(tdCamera, cameraData);

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
  xPos: number,
  yPos: number,
  zPos: number,
  left: number,
  right: number,
  top: number,
  bottom: number,
};

function updateCamera(camera: THREE.Camera, cameraData: CameraData) {
  camera.position.set(...cameraData.position);
  camera.left = cameraData.left;
  camera.right = cameraData.right;
  camera.top = cameraData.top;
  camera.bottom = cameraData.bottom;
  camera.up = new THREE.Vector3(...cameraData.up);
  camera.lookAt(new THREE.Vector3(...cameraData.lookAt));

  camera.updateProjectionMatrix();
}

const quaternionPresets = {
  [OrthoViews.TDView]: new THREE.Quaternion(
    0.29375689501628066,
    0.8059019432542462,
    -0.4760969023931061,
    -0.19380578944167975,
  ),
};

export function threeCameraToCameraData(camera: THREE.OrthographicCamera): CameraData {
  const { position, up, near, far, lookAt, left, right, top, bottom } = camera;
  const objToArr = ({ x, y, z }) => [x, y, z];
  return {
    left,
    right,
    top,
    bottom,
    near,
    far,
    position: objToArr(position),
    up: objToArr(up),
    lookAt: objToArr(lookAt),
  };
}

export function rotate3DViewTo(id: OrthoView, animate: boolean = true): void {
  const state = Store.getState();
  const { dataset } = state;
  const { tdCamera } = state.viewModeData.plane;
  const flycamPos = voxelToNm(dataset.dataSource.scale, getPosition(state.flycam));
  const datasetExtent = getDatasetExtentInLength(dataset);
  // This distance ensures that the 3D camera is so far "in the back" that all elements in the scene
  // are in front of it and thus visible.
  const clippingOffsetFactor = 900000;
  const copyOfTdCamera = new THREE.OrthographicCamera();
  copyOfTdCamera.useQuaternion = true;
  updateCamera(copyOfTdCamera, tdCamera);
  const cameraStartingQuaternion = copyOfTdCamera.quaternion.clone();
  console.log(copyOfTdCamera.quaternion);
  const currentQuaternion = new THREE.Quaternion();
  new TWEEN.Tween({})
    .to({}, 1000)
    .onUpdate(passedTime => {
      // TweenJS passes the current state via the `this` object.
      // However, for better type checking, we pass it as an explicit
      // parameter.
      // console.log("passedTime", passedTime);
      THREE.Quaternion.slerp(
        cameraStartingQuaternion,
        quaternionPresets[OrthoViews.TDView],
        currentQuaternion,
        passedTime,
      );
      copyOfTdCamera.quaternion.slerp(currentQuaternion, 0.01);
      copyOfTdCamera.updateProjectionMatrix();
      console.log(currentQuaternion.clone());
      console.log(copyOfTdCamera.quaternion.clone());
      console.log(threeCameraToCameraData(copyOfTdCamera));
    })
    .start();

  // Use width and height to keep the same zoom.
  let width = tdCamera.right - tdCamera.left;
  let height = tdCamera.top - tdCamera.bottom;

  let position: Vector3;
  let up: Vector3;
  // Way to calculate the position and rotation of the camera:
  // First, the camera is either positioned at the current center of the flycam or in the dataset center.
  // Second, the camera is moved backwards by a clipping offset into the wanted direction.
  // Together with matching lookUp (up) vectors and keeping the width and height, the position and rotation updates correctly.
  if (id === OrthoViews.TDView && (height <= 0 || width <= 0)) {
    // This should only be the case when initializing the 3D-viewport.
    const aspectRatio = getInputCatcherAspectRatio(state, OrthoViews.TDView);
    const datasetCenter = voxelToNm(dataset.dataSource.scale, getDatasetCenter(dataset));
    // The camera has no width and height which might be due to a bug or the camera has not been initialized.
    // Thus we zoom out to show the whole dataset.
    const paddingFactor = 1.1;
    width =
      Math.sqrt(
        datasetExtent.width * datasetExtent.width + datasetExtent.height * datasetExtent.height,
      ) * paddingFactor;
    height = width / aspectRatio;
    up = [0, 0, -1];
    // For very tall datasets that have a very low or high z starting coordinate, the planes might not be visible.
    // Thus take the z coordinate of the flycam instead of the z coordinate of the center.
    position = [
      datasetCenter[0] - clippingOffsetFactor,
      datasetCenter[1] - clippingOffsetFactor,
      flycamPos[2] - clippingOffsetFactor,
    ];
  } else if (id === OrthoViews.TDView) {
    position = [
      flycamPos[0] - clippingOffsetFactor,
      flycamPos[1] - clippingOffsetFactor,
      flycamPos[2] - clippingOffsetFactor,
    ];
    up = [0, 0, -1];
  } else {
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
    up = upVector[id];
    position = [
      positionOffset[id][0] + flycamPos[0],
      positionOffset[id][1] + flycamPos[1],
      positionOffset[id][2] + flycamPos[2],
    ];
  }
  // Ensure a valid width and height if camera ended up with no width and height due to a bug.
  width = width > 0 ? width : datasetExtent.width;
  height = height > 0 ? height : datasetExtent.height;
  const to: TweenState = {
    xPos: position[0],
    yPos: position[1],
    zPos: position[2],
    upX: up[0],
    upY: up[1],
    upZ: up[2],
    left: -width / 2,
    right: width / 2,
    top: height / 2,
    bottom: -height / 2,
  };

  const updateCameraTDView = (tweenState: TweenState) => {
    const currentFlycamPos = voxelToNm(
      Store.getState().dataset.dataSource.scale,
      getPosition(Store.getState().flycam),
    );
    const { xPos, yPos, zPos, upX, upY, upZ, left, right, top, bottom } = tweenState;
    Store.dispatch(
      setTDCameraAction({
        position: [xPos, yPos, zPos],
        up: [upX, upY, upZ],
        left,
        right,
        top,
        bottom,
        lookAt: currentFlycamPos,
      }),
    );
  };

  if (animate) {
    const from: TweenState = {
      upX: tdCamera.up[0],
      upY: tdCamera.up[1],
      upZ: tdCamera.up[2],
      xPos: tdCamera.position[0],
      yPos: tdCamera.position[1],
      zPos: tdCamera.position[2],
      left: tdCamera.left,
      right: tdCamera.right,
      top: tdCamera.top,
      bottom: tdCamera.bottom,
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
