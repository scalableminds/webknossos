import { V3 } from "libs/mjs";
import * as Utils from "libs/utils";
import _ from "lodash";
import * as React from "react";
import * as THREE from "three";
import TWEEN from "tween.js";
import type { OrthoView, OrthoViewMap, OrthoViewRects, Vector3 } from "viewer/constants";
import {
  OrthoCamerasBaseRotations,
  OrthoViewValuesWithoutTDView,
  OrthoViews,
} from "viewer/constants";
import { getDatasetExtentInUnit } from "viewer/model/accessors/dataset_accessor";
import { getPosition, getRotationInRadian } from "viewer/model/accessors/flycam_accessor";
import {
  getInputCatcherAspectRatio,
  getPlaneExtentInVoxelFromStore,
} from "viewer/model/accessors/view_mode_accessor";
import { setTDCameraWithoutTimeTrackingAction } from "viewer/model/actions/view_mode_actions";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import { getBaseVoxelInUnit, voxelToUnit } from "viewer/model/scaleinfo";
import { api } from "viewer/singletons";
import type { CameraData } from "viewer/store";
import Store from "viewer/store";

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
  // Up might not be completely orthogonal to forward, so we need to correct it.
  // Such tiny error would else lead to a non-orthogonal basis matrix leading to
  // potentially very large errors in the calculated quaternion.
  const correctedUp = V3.normalize(V3.cross(forward, right));

  // Create a basis matrix
  const rotationMatrix = new THREE.Matrix4();
  rotationMatrix.makeBasis(
    new THREE.Vector3(...right),
    new THREE.Vector3(...correctedUp),
    new THREE.Vector3(...forward),
  );

  // Convert to quaternion
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
  // Properties are only created here to avoid creating new objects for each update call.
  flycamRotationEuler = new THREE.Euler();
  flycamRotationMatrix = new THREE.Matrix4();
  baseRotationMatrix = new THREE.Matrix4();
  totalRotationMatrix = new THREE.Matrix4();

  componentDidMount() {
    // Take the whole diagonal extent of the dataset to get the possible maximum extent of the dataset.
    // This is used as an indication to set the far plane. This needs to be multiplied by 2
    // as the dataset planes in the 3d viewport are offset by the maximum of width, height and extent to ensure the dataset is visible.
    const datasetExtent = getDatasetExtentInUnit(Store.getState().dataset);
    const diagonalDatasetExtent = Math.sqrt(
      datasetExtent.width ** 2 + datasetExtent.height ** 2 + datasetExtent.depth ** 2,
    );
    const far = Math.max(8000000, diagonalDatasetExtent * 2);

    for (const cam of _.values(this.props.cameras)) {
      cam.near = 0;
      cam.far = far;
    }

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
        const tdData = Store.getState().viewModeData.plane.tdCamera;
        this.updateTDCamera(tdData);
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
    const scaleFactor = getBaseVoxelInUnit(state.dataset.dataSource.scale.factor);

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
    const globalPosition = getPosition(state.flycam);
    // camera position's unit is nm, so convert it.
    const cameraPosition = voxelToUnit(state.dataset.dataSource.scale, globalPosition);
    // Now set rotation for all cameras respecting the base rotation of each camera.
    const globalRotation = getRotationInRadian(state.flycam);
    this.flycamRotationEuler.set(globalRotation[0], globalRotation[1], globalRotation[2], "ZYX");
    this.flycamRotationMatrix.makeRotationFromEuler(this.flycamRotationEuler);
    for (const viewport of OrthoViewValuesWithoutTDView) {
      this.props.cameras[viewport].position.set(
        cameraPosition[0],
        cameraPosition[1],
        cameraPosition[2],
      );
      this.baseRotationMatrix.makeRotationFromEuler(OrthoCamerasBaseRotations[viewport]);
      this.props.cameras[viewport].setRotationFromMatrix(
        this.totalRotationMatrix
          .identity()
          .multiply(this.flycamRotationMatrix)
          .multiply(this.baseRotationMatrix),
      );
      this.props.cameras[viewport].updateProjectionMatrix();
    }
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
export function rotate3DViewTo(
  id: OrthoView,
  animate: boolean = true,
  onComplete?: () => void,
): void {
  const state = Store.getState();
  const { dataset } = state;
  const { tdCamera } = state.viewModeData.plane;
  const flycamPos = voxelToUnit(dataset.dataSource.scale, getPosition(state.flycam));
  const flycamRotation = getRotationInRadian(state.flycam);
  const datasetExtent = getDatasetExtentInUnit(dataset);
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

  // Way to calculate the position and rotation of the camera:
  // First, the camera is either positioned at the current center of the flycam or in the dataset center.
  // Second, the camera is moved backwards by a clipping offset into the wanted direction.
  // Together with matching lookUp (up) vectors and keeping the width and height, the position and rotation updates correctly.
  if (id === OrthoViews.TDView && (height <= 0 || width <= 0)) {
    // This should only be the case when initializing the 3D-viewport.
    const aspectRatio = getInputCatcherAspectRatio(state, OrthoViews.TDView);
    // The camera has no width and height which might be due to a bug or the camera has not been initialized.
    // Thus we zoom out to show the whole dataset.
    const paddingFactor = 1.1;
    width = Math.sqrt(datasetExtent.width ** 2 + datasetExtent.height ** 2) * paddingFactor;
    height = width / aspectRatio;
  }
  const positionOffsetMap: OrthoViewMap<Vector3> = {
    [OrthoViews.PLANE_XY]: [0, 0, -clippingOffsetFactor],
    [OrthoViews.PLANE_YZ]: [clippingOffsetFactor, 0, 0],
    [OrthoViews.PLANE_XZ]: [0, clippingOffsetFactor, 0],
    // For very tall datasets that have a very low or high z starting coordinate, the planes might not be visible.
    // Thus take the z coordinate of the flycam instead of the z coordinate of the center.
    // The clippingOffsetFactor is added in x and y direction to get a view on the dataset the 3D view that is close to the plane views.
    // Thus the rotation between the 3D view to the eg. XY plane views is much shorter and the interpolated rotation does not look weird.
    // The z offset is halved to have a lower viewing angle at the plane.
    [OrthoViews.TDView]: [clippingOffsetFactor, clippingOffsetFactor, -clippingOffsetFactor / 2],
  };
  const upVectorMap: OrthoViewMap<Vector3> = {
    [OrthoViews.PLANE_XY]: [0, -1, 0],
    [OrthoViews.PLANE_YZ]: [0, -1, 0],
    [OrthoViews.PLANE_XZ]: [0, 0, -1],
    [OrthoViews.TDView]: [0, 0, -1],
  };

  const positionOffsetVector = new THREE.Vector3(...positionOffsetMap[id]);
  const upVector = new THREE.Vector3(...upVectorMap[id]);
  // Rotate the positionOffsetVector and upVector by the flycam rotation.
  const rotatedOffset = positionOffsetVector.applyEuler(new THREE.Euler(...flycamRotation, "ZYX"));
  const rotatedUp = upVector.applyEuler(new THREE.Euler(...flycamRotation, "ZYX"));
  const position = [
    flycamPos[0] + rotatedOffset.x,
    flycamPos[1] + rotatedOffset.y,
    flycamPos[2] + rotatedOffset.z,
  ] as Vector3;
  const up = [rotatedUp.x, rotatedUp.y, rotatedUp.z] as Vector3;

  // Compute current and target orientation as quaternion. When tweening between
  // these orientations, we compute the new camera position by keeping the distance
  // (radius) to currentFlycamPos constant. Consequently, the camera moves on the
  // surfaces of a sphere with the center at currentFlycamPos.
  const startQuaternion = getQuaternionFromCamera(tdCamera.up, tdCamera.position, flycamPos);
  const targetQuaternion = getQuaternionFromCamera(up, position, flycamPos);
  const centerDistance = V3.length(V3.sub(flycamPos, position));
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
    const newPosition = V3.toArray(V3.sub(flycamPos, V3.scale(tweened.forward, centerDistance)));
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
      .onComplete(() => {
        onComplete?.();
      })
      .start();
  } else {
    updateCameraTDView(to, 1);
    onComplete?.();
  }
}
export default CameraController;
