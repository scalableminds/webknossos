import { V3 } from "libs/mjs";
import { waitForElementWithId } from "libs/utils";
import { PureComponent } from "react";
import {
  Euler,
  MathUtils,
  Matrix4,
  type OrthographicCamera,
  type PerspectiveCamera,
  Quaternion,
  Vector3 as ThreeVector3,
} from "three";
import TWEEN from "tween.js";
import type { OrthoView, OrthoViewMap, OrthoViewRects, Vector3 } from "viewer/constants";
import {
  OrthoCamerasBaseRotations,
  OrthoViews,
  OrthoViewValuesWithoutTDView,
  TDViewPerspectiveFov,
} from "viewer/constants";
import { getDatasetExtentInUnit } from "viewer/model/accessors/dataset_accessor";
import { getPosition, getRotationInRadian } from "viewer/model/accessors/flycam_accessor";
import { isSkeletonSectionClippingActive } from "viewer/model/accessors/skeletontracing_accessor";
import {
  getInputCatcherAspectRatio,
  getPlaneExtentInVoxelFromStore,
} from "viewer/model/accessors/view_mode_accessor";
import { setTDCameraWithoutTimeTrackingAction } from "viewer/model/actions/view_mode_actions";
import Dimensions from "viewer/model/dimensions";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import { getBaseVoxelInUnit, voxelToUnit } from "viewer/model/scaleinfo";
import { api } from "viewer/singletons";
import type { CameraData } from "viewer/store";
import Store from "viewer/store";

type Props = {
  cameras: OrthoViewMap<OrthographicCamera>;
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
  const rotationMatrix = new Matrix4();
  rotationMatrix.makeBasis(
    new ThreeVector3(...right),
    new ThreeVector3(...correctedUp),
    new ThreeVector3(...forward),
  );

  // Convert to quaternion
  const quat = new Quaternion();
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

// The orthographic camera's frustum (left/right/top/bottom) defines which rectangle
// of the plane through the trackball target (perpendicular to the viewing direction)
// is visible. This function positions the perspective camera along the same viewing
// direction so that it sees exactly that rectangle at the target's distance. As a
// consequence, all orthographic camera logic (zooming by shrinking the frustum,
// panning by shifting it, trackball rotation around the target) translates naturally
// to the perspective camera (dollying, trucking, orbiting).
export function updatePerspectiveCameraFromOrthographic(
  orthoCamera: OrthographicCamera,
  perspectiveCamera: PerspectiveCamera,
  target: ThreeVector3,
): void {
  const width = orthoCamera.right - orthoCamera.left;
  const height = orthoCamera.top - orthoCamera.bottom;
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width + height)) {
    // The orthographic camera is not (fully) initialized yet.
    return;
  }
  const middleX = (orthoCamera.left + orthoCamera.right) / 2;
  const middleY = (orthoCamera.top + orthoCamera.bottom) / 2;
  orthoCamera.updateMatrixWorld();
  // Camera-space basis vectors in world coordinates. The camera looks down its
  // negative z-axis, so "back" is the third column of the world matrix.
  const rightVec = new ThreeVector3().setFromMatrixColumn(orthoCamera.matrixWorld, 0);
  const upVec = new ThreeVector3().setFromMatrixColumn(orthoCamera.matrixWorld, 1);
  const backVec = new ThreeVector3().setFromMatrixColumn(orthoCamera.matrixWorld, 2);
  // Distance at which the perspective camera sees exactly `height` at the target plane.
  const distance = height / 2 / Math.tan(MathUtils.degToRad(TDViewPerspectiveFov) / 2);
  perspectiveCamera.position
    .copy(target)
    .addScaledVector(rightVec, middleX)
    .addScaledVector(upVec, middleY)
    .addScaledVector(backVec, distance);
  perspectiveCamera.quaternion.copy(orthoCamera.quaternion);
  perspectiveCamera.up.copy(orthoCamera.up);
  perspectiveCamera.fov = TDViewPerspectiveFov;
  perspectiveCamera.aspect = width / height;
  // Scale the near plane with the distance so that zooming in very closely
  // does not clip meshes; keep the far plane at least as far as the orthographic
  // camera's to never clip the dataset when zooming out.
  perspectiveCamera.near = distance / 100;
  perspectiveCamera.far = Math.max(orthoCamera.far, 4 * distance);
  perspectiveCamera.updateProjectionMatrix();
  perspectiveCamera.updateMatrixWorld();
  perspectiveCamera.userData.isDerived = true;
}

class CameraController extends PureComponent<Props> {
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'storePropertyUnsubscribers' has no initi... Remove this comment to see the full error message
  storePropertyUnsubscribers: Array<(...args: Array<any>) => any>;
  // Properties are only created here to avoid creating new objects for each update call.
  flycamRotationEuler = new Euler();
  flycamRotationMatrix = new Matrix4();
  baseRotationMatrix = new Matrix4();
  totalRotationMatrix = new Matrix4();

  componentDidMount() {
    // Take the whole diagonal extent of the dataset to get the possible maximum extent of the dataset.
    // This is used as an indication to set the far plane. This needs to be multiplied by 2
    // as the dataset planes in the 3d viewport are offset by the maximum of width, height and extent to ensure the dataset is visible.
    const datasetExtent = getDatasetExtentInUnit(Store.getState().dataset);
    const diagonalDatasetExtent = Math.sqrt(
      datasetExtent.width ** 2 + datasetExtent.height ** 2 + datasetExtent.depth ** 2,
    );
    const far = Math.max(8000000, diagonalDatasetExtent * 2);

    for (const cam of Object.values(this.props.cameras)) {
      cam.near = 0;
      cam.far = far;
    }

    const tdId = `inputcatcher_${OrthoViews.TDView}`;
    this.bindToEvents();
    waitForElementWithId(tdId).then(() => {
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
    });
  }

  componentWillUnmount() {
    this.storePropertyUnsubscribers.forEach((fn) => {
      fn();
    });
  }

  // Non-TD-View methods
  updateCamViewport(inputCatcherRects?: OrthoViewRects): void {
    const state = Store.getState();
    const { clippingDistance } = state.userConfiguration;
    const scaleFactor = getBaseVoxelInUnit(state.dataset.dataSource.scale.factor);
    // While section clipping is active, the skeleton shaders cull precisely to the
    // current section. Make sure the camera's near plane never clips on-section
    // skeleton by using at least one full perpendicular voxel as the near distance.
    const isSectionClippingActive = isSkeletonSectionClippingActive(state);

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
      const effectiveClippingDistance = isSectionClippingActive
        ? Math.max(
            clippingDistance,
            state.dataset.dataSource.scale.factor[Dimensions.getIndices(planeId)[2]],
          )
        : clippingDistance;
      // We only set the `near` value here. The effect of far=clippingDistance is
      // achieved by offsetting the plane onto which is rendered by the amount
      // of clippingDistance. Theoretically, `far` could be set here too, however,
      // this leads to imprecision related bugs which cause the planes to not render
      // for certain clippingDistance values.
      this.props.cameras[planeId].near = -effectiveClippingDistance;
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
      // Re-run when section clipping is (de)activated (toggle, rotation, transform),
      // so that the near plane switches between distance- and section-based clipping.
      listenToStoreProperty(
        (storeState) => isSkeletonSectionClippingActive(storeState),
        () => this.updateCamViewport(),
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
        (storeState) => storeState.flycam.currentMatrix,
        // Keep the trackball target of the 3D viewport in sync with the flycam.
        // For the orthographic camera this has no visible effect (which is why it
        // used to happen only lazily when hovering the 3D viewport), but the derived
        // perspective camera is anchored at the target, so it would lag behind
        // flycam movements otherwise.
        () => this.props.setTargetAndFixPosition(),
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
    tdCamera.up = new ThreeVector3(...cameraData.up);
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

  const positionOffsetVector = new ThreeVector3(...positionOffsetMap[id]);
  const upVector = new ThreeVector3(...upVectorMap[id]);
  // Rotate the positionOffsetVector and upVector by the flycam rotation.
  const rotatedOffset = positionOffsetVector.applyEuler(new Euler(...flycamRotation, "ZYX"));
  const rotatedUp = upVector.applyEuler(new Euler(...flycamRotation, "ZYX"));
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
    const tweenedQuat = new Quaternion();
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
