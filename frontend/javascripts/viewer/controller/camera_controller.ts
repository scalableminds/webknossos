import { V3 } from "libs/mjs";
import { waitForElementWithId } from "libs/utils";
import { PureComponent } from "react";
import {
  Euler,
  Matrix4,
  type OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector3 as ThreeVector3,
} from "three";
import TWEEN from "tween.js";
import type { OrthoView, OrthoViewMap, OrthoViewRects, Vector3 } from "viewer/constants";
import {
  OrthoCamerasBaseRotations,
  OrthoViews,
  OrthoViewValuesWithoutTDView,
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
  cameras: OrthoViewMap<OrthographicCamera | PerspectiveCamera>;
  onCameraPositionChanged: () => void;
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

class CameraController extends PureComponent<Props> {
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'storePropertyUnsubscribers' has no initi... Remove this comment to see the full error message
  storePropertyUnsubscribers: Array<(...args: Array<any>) => any>;
  tdViewDiagonalDatasetExtent: number = 0;
  // Track the last stored (non-pulled-back) TDView camera position/up/target so that
  // the pullback in updateTDCamera doesn't cause the next frame to see a spurious
  // "position changed" → lookAt loop, and so that lookAt is called whenever any of
  // them actually changes.
  lastTDCameraPosition = new ThreeVector3(Number.NaN, Number.NaN, Number.NaN);
  lastTDCameraUp = new ThreeVector3(Number.NaN, Number.NaN, Number.NaN);
  lastTDCameraTarget = new ThreeVector3(Number.NaN, Number.NaN, Number.NaN);
  lastTDProjectionDistance = 1;
  // Last seen TDView frustum extents, used to detect a re-centering (centerTDView)
  // even when its new target happens to land on the current look ray.
  lastTDCameraFrustum = {
    left: Number.NaN,
    right: Number.NaN,
    top: Number.NaN,
    bottom: Number.NaN,
  };
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
    this.tdViewDiagonalDatasetExtent = diagonalDatasetExtent;
    const far = Math.max(8000000, diagonalDatasetExtent * 2);

    for (const cam of Object.values(this.props.cameras)) {
      cam.near = cam instanceof PerspectiveCamera ? Math.max(cam.near, 0.1) : 0;
      cam.far = far;
    }

    const tdId = `inputcatcher_${OrthoViews.TDView}`;
    this.bindToEvents();
    waitForElementWithId(tdId).then(() => {
      this.props.setTargetAndFixPosition();
      const state = Store.getState();
      const flycamPosition = voxelToUnit(state.dataset.dataSource.scale, getPosition(state.flycam));
      Store.dispatch(
        setTDCameraWithoutTimeTrackingAction({
          near: this.props.cameras[OrthoViews.TDView] instanceof PerspectiveCamera ? 0.1 : 0,
          far,
          target: flycamPosition,
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

    for (const planeId of OrthoViewValuesWithoutTDView) {
      const [width, height] = getPlaneExtentInVoxelFromStore(
        state,
        state.flycam.zoomStep,
        planeId,
      ).map((x) => x * scaleFactor);
      const camera = this.props.cameras[planeId] as OrthographicCamera;
      camera.left = -width / 2;
      camera.right = width / 2;
      camera.bottom = -height / 2;
      camera.top = height / 2;
      // We only set the `near` value here. The effect of far=clippingDistance is
      // achieved by offsetting the plane onto which is rendered by the amount
      // of clippingDistance. Theoretically, `far` could be set here too, however,
      // this leads to imprecision related bugs which cause the planes to not render
      // for certain clippingDistance values.
      camera.near = -clippingDistance;
      camera.updateProjectionMatrix();
    }

    if (inputCatcherRects != null) {
      // Update td camera's aspect ratio (stored as left/right)
      const tdRect = inputCatcherRects[OrthoViews.TDView];
      // Do not update the tdCamera if the tdView is not visible
      if (tdRect.height === 0 || tdRect.width === 0) return;
      const tdCameraData = Store.getState().viewModeData.plane.tdCamera;
      const oldMid = (tdCameraData.right + tdCameraData.left) / 2;
      const oldWidth = tdCameraData.right - tdCameraData.left;
      const oldHeight = tdCameraData.top - tdCameraData.bottom;
      if (oldHeight === 0) {
        return;
      }
      const oldAspectRatio = oldWidth / oldHeight;
      const newAspectRatio = tdRect.width / tdRect.height;
      const newWidth = (oldWidth * newAspectRatio) / oldAspectRatio;
      Store.dispatch(
        setTDCameraWithoutTimeTrackingAction({
          left: oldMid - newWidth / 2,
          right: oldMid + newWidth / 2,
        }),
      );
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
    const threeTarget = new ThreeVector3(...cameraData.target);

    const newStoredPosition = new ThreeVector3(...cameraData.position);
    const newStoredUp = new ThreeVector3(...cameraData.up);

    // Compare against the *stored* position, not tdCamera.position. The Three.js
    // camera object may have been shifted by the pullback below, so reading
    // tdCamera.position would cause a spurious "changed" on the next frame and
    // trigger a lookAt loop / numeric instability.
    const positionChanged = !newStoredPosition.equals(this.lastTDCameraPosition);
    const upChanged = !newStoredUp.equals(this.lastTDCameraUp);
    const targetChanged = !threeTarget.equals(this.lastTDCameraTarget);
    const frustumChanged =
      cameraData.left !== this.lastTDCameraFrustum.left ||
      cameraData.right !== this.lastTDCameraFrustum.right ||
      cameraData.top !== this.lastTDCameraFrustum.top ||
      cameraData.bottom !== this.lastTDCameraFrustum.bottom;
    this.lastTDCameraFrustum.left = cameraData.left;
    this.lastTDCameraFrustum.right = cameraData.right;
    this.lastTDCameraFrustum.top = cameraData.top;
    this.lastTDCameraFrustum.bottom = cameraData.bottom;

    if (positionChanged || upChanged) {
      this.lastTDCameraPosition.copy(newStoredPosition);
      this.lastTDCameraUp.copy(newStoredUp);
    }
    if (targetChanged) {
      this.lastTDCameraTarget.copy(threeTarget);
    }

    // Always write the stored position/up to the camera; the pullback below may
    // then override position, but we always start from the canonical stored state.
    tdCamera.position.copy(newStoredPosition);
    tdCamera.up.copy(newStoredUp);

    // lookAtRequired tracks whether we need to re-orient the camera AND refresh the
    // projection distance. It is true when the camera actually moved/rotated (user
    // orbit), or when centerTDViewReducer deliberately set the target off the look
    // ray so the camera must face the new scene position.
    let lookAtRequired = positionChanged || upChanged;

    if (!lookAtRequired && targetChanged) {
      // Target-only changes come from two sources:
      //
      // 1. setTargetAndFixPosition — projects the desired target onto the camera's
      //    current look ray. lookAt(projected_target) is a geometric no-op and, more
      //    importantly, must NOT trigger a projection-distance refresh: the pullback
      //    formula is P_pb = storedPos + backward × max(0, minSafe − projDist).
      //    If projDist were updated here the pullback would shift on every hover entry.
      //
      // 2. centerTDViewReducer — sets the target to the actual flycam position, which
      //    may be off the look ray, so the camera must re-orient and projDist must
      //    reflect the new scene depth.
      //
      // Distinguish the two by measuring the perpendicular distance from the new
      // target to the current forward ray. Projected targets land on the ray
      // (perpDistance ≈ 0); actual flycam positions can be significantly off-axis.
      //
      // The perpendicular test alone misclassifies the rare case where the flycam
      // position happens to lie on the look ray (perpDistance ≈ 0 at a different
      // depth), leaving projDist stale. centerTDViewReducer always re-centers the
      // frustum in the same store update, while setTargetAndFixPosition never touches
      // it, so a simultaneous frustum change is an unambiguous recenter signal.
      const forward = new ThreeVector3(0, 0, -1).applyQuaternion(tdCamera.quaternion);
      const toTarget = threeTarget.clone().sub(newStoredPosition);
      const perpDistance = toTarget
        .clone()
        .addScaledVector(forward, -toTarget.dot(forward))
        .length();
      if (perpDistance > 1.0 || frustumChanged) {
        lookAtRequired = true;
      }
    }

    if (lookAtRequired) {
      tdCamera.lookAt(threeTarget);
      // Refresh the projection distance so the pullback and near/far scale stay
      // correct for the new camera orientation or scene position.
      this.lastTDProjectionDistance = Math.max(1, newStoredPosition.distanceTo(threeTarget));
    }

    if (tdCamera instanceof PerspectiveCamera) {
      // Interpret left/right/top/bottom as viewplane extents at the target depth and
      // use an off-axis perspective projection to preserve pan/zoom semantics.

      // When zoomed out far, plane vertices can go behind the camera, which causes
      // severe distortion because the perspective divide produces garbage clip-space
      // coordinates for w < 0 vertices (they don't just get cleanly clipped).
      // Pull the camera back along its view direction when necessary.
      const maxViewExtent = Math.max(
        Math.abs(cameraData.left),
        Math.abs(cameraData.right),
        Math.abs(cameraData.top),
        Math.abs(cameraData.bottom),
      );
      if (maxViewExtent === 0) {
        // Degenerate frustum (left==right and top==bottom), e.g. the initial all-zero
        // default store state before rotate3DViewTo populates real extents. Unlike the
        // orthographic branch, makePerspective would divide by (right-left)=0 here and
        // produce a NaN/Infinity projection matrix. Skip the update and wait for the next
        // frame, which will carry real extents.
        tdCamera.userData.tdPullbackDistance = 0;
        this.props.onCameraPositionChanged();
        return;
      }

      const minSafeDistance = maxViewExtent * 1.5;
      const effectiveDistance = Math.max(this.lastTDProjectionDistance, minSafeDistance);

      // Record how far the live camera was pulled back from its stored position so
      // that onTDCameraChanged can strip it again before persisting the position to
      // the store. Otherwise the pulled-back position leaks into the store (e.g. when
      // a click engages TrackballControls), breaking the invariant that the stored
      // position is the canonical, un-pulled-back one — which re-introduces the
      // projection jitter on hover.
      let appliedPullback = 0;
      if (effectiveDistance > this.lastTDProjectionDistance) {
        // Compute the pulled-back position from storedPos along the camera's backward
        // direction, NOT from threeTarget. Using threeTarget as the base would shift
        // P_pb whenever setTargetAndFixPosition moves the target along the look ray,
        // even though the camera and scene haven't moved — causing jitter on hover.
        const forward = new ThreeVector3(0, 0, -1).applyQuaternion(tdCamera.quaternion);
        appliedPullback = effectiveDistance - this.lastTDProjectionDistance;
        tdCamera.position.copy(newStoredPosition).addScaledVector(forward, -appliedPullback);
      }
      tdCamera.userData.tdPullbackDistance = appliedPullback;

      // Use near = effectiveDistance/1000 for good near/far ratio and depth precision.
      // so near = effectiveDistance/1000 is safe against clipping.
      const near = Math.max(0.1, effectiveDistance / 1000);
      const farPadding = Math.max(1000, this.tdViewDiagonalDatasetExtent * 2, maxViewExtent * 2);
      const far = Math.max(near + 1, effectiveDistance + farPadding);
      const scale = near / effectiveDistance;
      const left = cameraData.left * scale;
      const right = cameraData.right * scale;
      const top = cameraData.top * scale;
      const bottom = cameraData.bottom * scale;
      tdCamera.near = near;
      tdCamera.far = far;
      tdCamera.projectionMatrix.makePerspective(left, right, top, bottom, near, far);
      tdCamera.projectionMatrixInverse.copy(tdCamera.projectionMatrix).invert();
    } else {
      // When zoomed out far, data planes can extend behind the orthographic TDView camera.
      // Setting near to a large negative value ensures those vertices are not clipped.
      const viewExtent = Math.max(
        Math.abs(cameraData.right - cameraData.left),
        Math.abs(cameraData.top - cameraData.bottom),
      );
      const dynamicFar = Math.max(cameraData.far, viewExtent * 2);
      tdCamera.userData.tdPullbackDistance = 0;
      tdCamera.left = cameraData.left;
      tdCamera.right = cameraData.right;
      tdCamera.top = cameraData.top;
      tdCamera.bottom = cameraData.bottom;
      tdCamera.near = -dynamicFar;
      tdCamera.far = dynamicFar;
      tdCamera.updateProjectionMatrix();
    }
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
        target: flycamPos,
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
