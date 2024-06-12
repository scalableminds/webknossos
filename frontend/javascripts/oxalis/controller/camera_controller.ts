import * as React from "react";
import * as THREE from "three";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'twee... Remove this comment to see the full error message
import TWEEN from "tween.js";
import _ from "lodash";
import * as Utils from "libs/utils";
import type { OrthoView, OrthoViewMap, OrthoViewRects, Vector3 } from "oxalis/constants";
import { OrthoViewValuesWithoutTDView, OrthoViews } from "oxalis/constants";
import { V3 } from "libs/mjs";
import {
  getDatasetExtentInLength,
  getDatasetCenter,
} from "oxalis/model/accessors/dataset_accessor";
import {
  getInputCatcherAspectRatio,
  getPlaneExtentInVoxelFromStore,
} from "oxalis/model/accessors/view_mode_accessor";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { setTDCameraWithoutTimeTrackingAction } from "oxalis/model/actions/view_mode_actions";
import { voxelToNm, getBaseVoxel } from "oxalis/model/scaleinfo";
import type { CameraData } from "oxalis/store";
import Store from "oxalis/store";
import { api } from "oxalis/singletons";

type Props = {
  cameras: OrthoViewMap<THREE.OrthographicCamera>;
  onCameraPositionChanged: () => void;
  onTDCameraChanged: (userTriggered?: boolean) => void;
  setTargetAndFixPosition: () => void;
};

function getQuaternionFromCamera(_up: Vector3, position: Vector3, center: Vector3) {
  const up = V3.normalize(_up);
  const forward = V3.normalize(V3.sub(center, position));
  const right = V3.normalize(V3.cross(up, forward));
  const rotationMatrix = new THREE.Matrix4();
  // biome-ignore format: don't format
  rotationMatrix.set(right[0], up[0], forward[0], 0, right[1], up[1], forward[1], 0, right[2], up[2], forward[2], 0, 0, 0, 0, 1);
  const quat = new THREE.Quaternion();
  quat.setFromRotationMatrix(rotationMatrix);
  return quat;
}

function getCameraFromQuaternion(quat: { x: number; y: number; z: number; w: number }) {
  // Derived from: https://stackoverflow.com/questions/1556260/convert-quaternion-rotation-to-rotation-matrix
  const { x, y, z, w } = quat;
  const right: Vector3 = [
    1.0 - 2.0 * y * y - 2.0 * z * z,
    2.0 * x * y + 2.0 * z * w,
    2.0 * x * z - 2.0 * y * w,
  ];
  const up: Vector3 = [
    2.0 * x * y - 2.0 * z * w,
    1.0 - 2.0 * x * x - 2.0 * z * z,
    2.0 * y * z + 2.0 * x * w,
  ];
  const forward: Vector3 = [
    2.0 * x * z + 2.0 * y * w,
    2.0 * y * z - 2.0 * x * w,
    1.0 - 2.0 * x * x - 2.0 * y * y,
  ];
  return {
    right,
    up,
    forward,
  };
}

class CameraController extends React.PureComponent<Props> {
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'storePropertyUnsubscribers' has no initi... Remove this comment to see the full error message
  storePropertyUnsubscribers: Array<(...args: Array<any>) => any>;

  componentDidMount() {
    const far = 8000000;

    for (const cam of _.values(this.props.cameras)) {
      cam.near = 0;
      cam.far = far;
    }
    // Take the whole diagonal extent of the dataset to get the possible maximum extent of the dataset.
    // This is used as an indication to set the far plane. This needs to be multiplied by 2
    // as the dataset planes in the 3d viewport are offset by the maximum of width, height and extent to ensure the dataset is visible.
    const datasetExtent = getDatasetExtentInLength(Store.getState().dataset);
    const diagonalDatasetExtent = Math.sqrt(
      datasetExtent.width ** 2 + datasetExtent.height ** 2 + datasetExtent.depth ** 2,
    );
    this.props.cameras[OrthoViews.TDView].far = diagonalDatasetExtent * 2;

    const tdId = `inputcatcher_${OrthoViews.TDView}`;
    this.bindToEvents();
    Utils.waitForElementWithId(tdId).then(() => {
      // Without this setTimeout, the initial camera angle/position
      // within the 3D viewport is incorrect.
      // Also see #5455.
      setTimeout(() => {
        this.props.setTargetAndFixPosition();
        Store.dispatch(
          setTDCameraWithoutTimeTrackingAction({
            near: 0,
            far,
          }),
        );
        api.tracing.rotate3DViewToDiagonal(false);
        this.updateTDCamera(Store.getState().viewModeData.plane.tdCamera);
      }, 0);
    });
  }

  componentWillUnmount() {
    this.storePropertyUnsubscribers.forEach((fn) => fn());
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
      ).map((x) => x * scaleFactor);
      this.props.cameras[planeId].left = -width / 2;
      this.props.cameras[planeId].right = width / 2;
      this.props.cameras[planeId].bottom = -height / 2;
      this.props.cameras[planeId].top = height / 2;
      // We only set the `near` value here. The effect of far=clippingDistance is
      // achieved by offsetting the plane onto which is rendered by the amount
      // of clippingDistance. Theoretically, `far` could be set here too, however,
      // this leads to imprecision related bugs which cause the planes to not render
      // for certain clippingDistance values.
      this.props.cameras[planeId].near = -clippingDistance;
      this.props.cameras[planeId].updateProjectionMatrix();
    }

    if (inputCatcherRects != null) {
      // Update td camera's aspect ratio
      const tdCamera = this.props.cameras[OrthoViews.TDView];
      const oldMid = (tdCamera.right + tdCamera.left) / 2;
      const oldWidth = tdCamera.right - tdCamera.left;
      const oldHeight = tdCamera.top - tdCamera.bottom;
      const tdRect = inputCatcherRects[OrthoViews.TDView];
      // Do not update the tdCamera if the tdView is not visible
      if (tdRect.height === 0 || tdRect.width === 0) return;
      const oldAspectRatio = oldWidth / oldHeight;
      const newAspectRatio = tdRect.width / tdRect.height;
      const newWidth = (oldWidth * newAspectRatio) / oldAspectRatio;
      tdCamera.left = oldMid - newWidth / 2;
      tdCamera.right = oldMid + newWidth / 2;
      tdCamera.updateProjectionMatrix();
      this.props.onTDCameraChanged(false);
    }
  }

  update(): void {
    const state = Store.getState();
    const gPos = getPosition(state.flycam);
    // camera position's unit is nm, so convert it.
    const cPos = voxelToNm(state.dataset.dataSource.scale, gPos);
    this.props.cameras[OrthoViews.PLANE_XY].position.set(cPos[0], cPos[1], cPos[2]);
    this.props.cameras[OrthoViews.PLANE_YZ].position.set(cPos[0], cPos[1], cPos[2]);
    this.props.cameras[OrthoViews.PLANE_XZ].position.set(cPos[0], cPos[1], cPos[2]);
  }

  bindToEvents() {
    this.storePropertyUnsubscribers = [
      listenToStoreProperty(
        (storeState) => storeState.userConfiguration.clippingDistance,
        () => this.updateCamViewport(),
        true,
      ),
      listenToStoreProperty(
        (storeState) => storeState.flycam.zoomStep,
        () => this.updateCamViewport(),
      ),
      listenToStoreProperty(
        (storeState) => storeState.viewModeData.plane.inputCatcherRects,
        (inputCatcherRects) => this.updateCamViewport(inputCatcherRects),
      ),
      listenToStoreProperty(
        (storeState) => storeState.flycam.currentMatrix,
        () => this.update(),
        true,
      ),
      listenToStoreProperty(
        (storeState) => storeState.viewModeData.plane.tdCamera,
        (cameraData) => this.updateTDCamera(cameraData),
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
    tdCamera.updateProjectionMatrix();
    this.props.onCameraPositionChanged();
  }

  render() {
    return null;
  }
}

type TweenState = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};
export function rotate3DViewTo(id: OrthoView, animate: boolean = true): void {
  const state = Store.getState();
  const { dataset } = state;
  const { tdCamera } = state.viewModeData.plane;
  const flycamPos = voxelToNm(dataset.dataSource.scale, getPosition(state.flycam));
  const datasetExtent = getDatasetExtentInLength(dataset);
  // This distance ensures that the 3D camera is so far "in the back" that all elements in the scene
  // are in front of it and thus visible.
  const clippingOffsetFactor = Math.max(
    datasetExtent.width,
    datasetExtent.height,
    datasetExtent.depth,
  );
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
    width = Math.sqrt(datasetExtent.width ** 2 + datasetExtent.height ** 2) * paddingFactor;
    height = width / aspectRatio;
    up = [0, 0, -1];
    // For very tall datasets that have a very low or high z starting coordinate, the planes might not be visible.
    // Thus take the z coordinate of the flycam instead of the z coordinate of the center.
    // The clippingOffsetFactor is added in x and y direction to get a view on the dataset the 3D view that is close to the plane views.
    // Thus the rotation between the 3D view to the eg. XY plane views is much shorter and the interpolated rotation does not look weird.
    position = [
      datasetCenter[0] + clippingOffsetFactor,
      datasetCenter[1] + clippingOffsetFactor,
      flycamPos[2] - clippingOffsetFactor,
    ];
  } else if (id === OrthoViews.TDView) {
    position = [
      flycamPos[0] + clippingOffsetFactor,
      flycamPos[1] + clippingOffsetFactor,
      flycamPos[2] - clippingOffsetFactor,
    ];
    up = [0, 0, -1];
  } else {
    const positionOffset: OrthoViewMap<Vector3> = {
      [OrthoViews.PLANE_XY]: [0, 0, -clippingOffsetFactor],
      [OrthoViews.PLANE_YZ]: [clippingOffsetFactor, 0, 0],
      [OrthoViews.PLANE_XZ]: [0, clippingOffsetFactor, 0],
      [OrthoViews.TDView]: [0, 0, 0],
    };
    const upVector: OrthoViewMap<Vector3> = {
      [OrthoViews.PLANE_XY]: [0, -1, 0],
      [OrthoViews.PLANE_YZ]: [0, -1, 0],
      [OrthoViews.PLANE_XZ]: [0, 0, -1],
      [OrthoViews.TDView]: [0, 0, 0],
    };
    up = upVector[id];
    position = [
      positionOffset[id][0] + flycamPos[0],
      positionOffset[id][1] + flycamPos[1],
      positionOffset[id][2] + flycamPos[2],
    ];
  }

  const currentFlycamPos = voxelToNm(
    Store.getState().dataset.dataSource.scale,
    getPosition(Store.getState().flycam),
  ) || [0, 0, 0];
  // Compute current and target orientation as quaternion. When tweening between
  // these orientations, we compute the new camera position by keeping the distance
  // (radius) to currentFlycamPos constant. Consequently, the camera moves on the
  // surfaces of a sphere with the center at currentFlycamPos.
  const startQuaternion = getQuaternionFromCamera(tdCamera.up, tdCamera.position, currentFlycamPos);
  const targetQuaternion = getQuaternionFromCamera(up, position, currentFlycamPos);
  const centerDistance = V3.length(V3.sub(currentFlycamPos, position));
  const to: TweenState = {
    left: -width / 2,
    right: width / 2,
    top: height / 2,
    bottom: -height / 2,
  };

  const updateCameraTDView = (tweenState: TweenState, t: number) => {
    const { left, right, top, bottom } = tweenState;
    const tweenedQuat = new THREE.Quaternion();
    tweenedQuat.slerpQuaternions(startQuaternion, targetQuaternion, t);
    const tweened = getCameraFromQuaternion(tweenedQuat);
    // Use forward vector and currentFlycamPos (lookAt target) to calculate the current
    // camera's position which should be on a sphere (center=currentFlycamPos, radius=centerDistance).
    const newPosition = V3.toArray(
      V3.sub(currentFlycamPos, V3.scale(tweened.forward, centerDistance)),
    );
    Store.dispatch(
      setTDCameraWithoutTimeTrackingAction({
        position: newPosition,
        up: tweened.up,
        left,
        right,
        top,
        bottom,
      }),
    );
  };

  if (animate) {
    const from: TweenState = {
      left: tdCamera.left,
      right: tdCamera.right,
      top: tdCamera.top,
      bottom: tdCamera.bottom,
    };
    const tween = new TWEEN.Tween(from);
    const time = 800;
    tween
      .to(to, time)
      .onUpdate(function updater(this: TweenState, t: number) {
        // TweenJS passes the current state via the `this` object.
        // However, for better type checking, we pass it as an explicit
        // parameter.
        updateCameraTDView(this, t);
      })
      .start();
  } else {
    updateCameraTDView(to, 1);
  }
}
export default CameraController;
