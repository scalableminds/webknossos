import { InputMouse } from "libs/input";
import { V3 } from "libs/mjs";
import TrackballControls from "libs/trackball_controls";
import { clamp, waitForElementWithId } from "libs/utils";
import get from "lodash-es/get";
import { PureComponent } from "react";
import { connect } from "react-redux";
import {
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Plane as ThreePlane,
  Vector2 as ThreeVector2,
  Vector3 as ThreeVector3,
} from "three";
import type { VoxelSize } from "types/api_types";
import {
  type OrthoView,
  type OrthoViewMap,
  OrthoViews,
  type Point2,
  type TDViewCameraMode,
  TDViewCameraModeEnum,
  type Vector3,
} from "viewer/constants";
import CameraController, { getTDViewFar, getTDViewNear } from "viewer/controller/camera_controller";
import { handleOpenContextMenu } from "viewer/controller/combinations/skeleton_handlers";
import {
  ProofreadToolController,
  SkeletonToolController,
} from "viewer/controller/combinations/tool_controls";
import { getPosition } from "viewer/model/accessors/flycam_accessor";
import { getActiveNode, getNodePosition } from "viewer/model/accessors/skeletontracing_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import {
  getFrustumHeightForPerspectiveDistance,
  getInputCatcherAspectRatio,
  getInputCatcherRect,
  getPerspectiveDistanceForFrustumHeight,
  getViewportScale,
} from "viewer/model/accessors/view_mode_accessor";
import { getActiveSegmentationTracing } from "viewer/model/accessors/volumetracing_accessor";
import { setPositionAction } from "viewer/model/actions/flycam_actions";
import { toggleSegmentInPartitionAction } from "viewer/model/actions/proofread_actions";
import {
  moveTDViewByVectorWithoutTimeTrackingAction,
  moveTDViewXAction,
  moveTDViewYAction,
  setTDCameraAction,
  setTDCameraWithoutTimeTrackingAction,
  setViewportAction,
  zoomTDViewAction,
} from "viewer/model/actions/view_mode_actions";
import { setActiveCellAction } from "viewer/model/actions/volumetracing_actions";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import { voxelToUnit } from "viewer/model/scaleinfo";
import type { PartialCameraData, StoreAnnotation, WebknossosState } from "viewer/store";
import Store from "viewer/store";
import type PlaneView from "viewer/view/plane_view";

type TDCamera = OrthographicCamera | PerspectiveCamera;

function threeCameraToCameraData(camera: TDCamera): PartialCameraData {
  const { position, up } = camera;

  const objToArr = ({ x, y, z }: { x: number; y: number; z: number }): Vector3 => [x, y, z];

  if (camera instanceof OrthographicCamera) {
    const { near, far, left, right, top, bottom } = camera;
    return {
      left,
      right,
      top,
      bottom,
      near,
      far,
      position: objToArr(position),
      up: objToArr(up),
    };
  }

  // A perspective camera has no orthographic frustum; only its position and up vector change
  // through user interaction. fov/near/far stay constant.
  return {
    position: objToArr(position),
    up: objToArr(up),
  };
}

function getTDViewMouseControlsSkeleton(planeView: PlaneView): Record<string, any> {
  return {
    leftClick: (
      pos: Point2,
      plane: OrthoView,
      event: MouseEvent,
      isTouch: boolean,
      activeTool: AnnotationTool,
    ) =>
      activeTool === AnnotationTool.PROOFREAD
        ? ProofreadToolController.onLeftClick(planeView, pos, plane, event, isTouch)
        : SkeletonToolController.onLeftClick(
            planeView,
            pos,
            event.shiftKey,
            event.altKey,
            event.ctrlKey || event.metaKey,
            OrthoViews.TDView,
            isTouch,
            false,
          ),
  };
}

const INVALID_ACTIVE_NODE_ID = -1;
type OwnProps = {
  cameras: OrthoViewMap<TDCamera>;
  planeView?: PlaneView;
  annotation?: StoreAnnotation;
};
type StateProps = {
  voxelSize: VoxelSize;
  activeTool: AnnotationTool;
};
type Props = OwnProps & StateProps;

function maybeGetActiveNodeFromProps(props: Props) {
  return props.annotation?.skeleton?.activeNodeId != null
    ? props.annotation.skeleton.activeNodeId
    : INVALID_ACTIVE_NODE_ID;
}

class TDController extends PureComponent<Props> {
  controls!: typeof TrackballControls;
  mouseController!: InputMouse;
  oldUnitPos!: Vector3;
  isStarted: boolean = false;
  raycaster: Raycaster = new Raycaster();
  unsubscribeCameraModeListener: (() => void) | null = null;

  componentDidMount() {
    const { dataset, flycam } = Store.getState();
    this.oldUnitPos = voxelToUnit(dataset.dataSource.scale, getPosition(flycam));
    this.isStarted = true;
    this.initMouse();

    // The perspective/orthographic toggle only applies to the plane mode's 3D viewport. The
    // arbitrary view (where planeView is undefined) always keeps an orthographic TDView camera.
    if (this.props.planeView != null) {
      this.unsubscribeCameraModeListener = listenToStoreProperty(
        (state) => state.userConfiguration.tdViewCameraMode,
        (mode) => this.onCameraModeChanged(mode),
      );
    }
  }

  componentDidUpdate(prevProps: Props) {
    if (
      maybeGetActiveNodeFromProps(this.props) !== maybeGetActiveNodeFromProps(prevProps) &&
      maybeGetActiveNodeFromProps(this.props) !== INVALID_ACTIVE_NODE_ID &&
      this.props.annotation &&
      this.props.annotation.skeleton
    ) {
      // The rotation center of this viewport is not updated to the new position after selecting a node in the viewport.
      // This happens because the selection of the node does not trigger a call to setTargetAndFixPosition directly.
      // Thus we do it manually whenever the active node changes.
      const activeNode = getActiveNode(this.props.annotation.skeleton);
      if (activeNode) {
        this.setTargetAndFixPosition(getNodePosition(activeNode, Store.getState()));
      }
    }
  }

  componentWillUnmount() {
    this.isStarted = false;

    if (this.mouseController != null) {
      this.mouseController.destroy();
    }

    if (this.controls != null) {
      this.controls.destroy();
    }

    if (this.unsubscribeCameraModeListener != null) {
      this.unsubscribeCameraModeListener();
      this.unsubscribeCameraModeListener = null;
    }
  }

  initMouse(): void {
    const tdView = OrthoViews.TDView;
    const inputcatcherId = `inputcatcher_${tdView}`;
    waitForElementWithId(inputcatcherId).then((view) => {
      if (!this.isStarted) {
        return;
      }

      this.mouseController = new InputMouse(inputcatcherId, this.getTDViewMouseControls(), tdView);
      this.initTrackballControls(view);
    });
  }

  initTrackballControls(view: HTMLElement): void {
    const { flycam } = Store.getState();

    const pos = voxelToUnit(this.props.voxelSize, getPosition(flycam));
    const tdCamera = this.props.cameras[OrthoViews.TDView];
    this.controls = new TrackballControls(
      tdCamera,
      view,
      new ThreeVector3(...pos),
      this.onTDCameraChanged,
    );
    this.controls.noZoom = true;
    this.controls.noPan = true;
    this.controls.staticMoving = true;
    this.controls.target.set(...pos);
    // This is necessary, since we instantiated this.controls now. This should be removed
    // when the workaround with requestAnimationFrame(initInputHandlers) is removed.
    this.forceUpdate();
  }

  updateControls = () => {
    if (!this.controls) {
      return;
    }

    this.controls.update(true);
  };

  getTDViewMouseControls(): Record<string, any> {
    const skeletonControls =
      this.props.annotation?.skeleton != null && this.props.planeView != null
        ? getTDViewMouseControlsSkeleton(this.props.planeView)
        : null;
    const controls = {
      leftDownMove: (delta: Point2) => this.moveTDView(delta),
      scroll: (value: number) => this.zoomTDView(clamp(-1, value, 1), true),
      over: () => {
        Store.dispatch(setViewportAction(OrthoViews.TDView));
        // Fix the rotation target of the TrackballControls
        this.setTargetAndFixPosition();
      },
      pinch: (delta: number) => this.zoomTDView(delta, true),
      mouseMove: (
        _delta: Point2,
        position: Point2,
        _id: string | null | undefined,
        event: MouseEvent,
      ) => {
        // Avoid mesh hit test when rotating or moving the 3d view for performance reasons
        if (this.props.planeView == null || event.buttons !== 0) {
          return;
        }

        this.props.planeView.performMeshHitTest([position.x, position.y]);
      },
      out: () => {
        this.props.planeView?.clearLastMeshHitTest();
      },
      leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        if (skeletonControls != null) {
          skeletonControls.leftClick(pos, plane, event, isTouch, this.props.activeTool);
        }

        if (this.props.planeView == null) {
          return;
        }

        const ctrlOrMetaPressed = event.ctrlKey || event.metaKey;
        if (!event.shiftKey && !ctrlOrMetaPressed) {
          // No modifiers were pressed. No mesh related action is necessary.
          return;
        }

        const intersection = this.getMeshIntersection(pos);
        if (intersection == null) {
          return;
        }

        if (!intersection) {
          return;
        }
        const { hitPosition } = intersection;

        const unscaledPosition = V3.divide3(hitPosition, this.props.voxelSize.factor);

        const state = Store.getState();
        const isMultiCutToolActive = state.userConfiguration.isMultiSplitActive;
        if (event.shiftKey) {
          if (
            ctrlOrMetaPressed &&
            isMultiCutToolActive &&
            intersection.unmappedSegmentId != null &&
            intersection.meshId != null
          ) {
            Store.dispatch(
              toggleSegmentInPartitionAction(
                intersection.unmappedSegmentId,
                2,
                intersection.meshId,
              ),
            );
          } else {
            Store.dispatch(setPositionAction(unscaledPosition));
          }
        } else if (
          ctrlOrMetaPressed &&
          intersection.meshId != null &&
          intersection.meshId != null
        ) {
          if (isMultiCutToolActive && intersection.unmappedSegmentId != null) {
            Store.dispatch(
              toggleSegmentInPartitionAction(
                intersection.unmappedSegmentId,
                1,
                intersection.meshId,
              ),
            );
          } else {
            const volumeTracing = getActiveSegmentationTracing(state);
            const deselect =
              volumeTracing?.activeUnmappedSegmentId != null &&
              volumeTracing?.activeUnmappedSegmentId === intersection.unmappedSegmentId;

            Store.dispatch(
              setActiveCellAction(
                intersection.meshId,
                undefined,
                undefined,
                deselect ? null : intersection.unmappedSegmentId,
              ),
            );
          }
        }
      },
      rightClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        if (this.props.planeView == null) return null;
        const intersection = this.getMeshIntersection(pos);
        handleOpenContextMenu(
          this.props.planeView,
          pos,
          plane,
          isTouch,
          event,
          intersection?.meshId,
          intersection?.meshClickedPosition,
          intersection?.unmappedSegmentId,
        );
      },
    };
    return controls;
  }

  getMeshIntersection(pos: Point2) {
    if (this.props.planeView == null) return null;
    const hitResult = this.props.planeView.performMeshHitTest([pos.x, pos.y], false);
    if (hitResult == null) {
      return null;
    }
    const meshId: number | null = hitResult ? get(hitResult.node.parent, "segmentId", null) : null;
    const unmappedSegmentId: number | null = hitResult?.unmappedSegmentId || null;
    const meshClickedPosition = hitResult ? hitResult.point : null;
    return { meshId, unmappedSegmentId, meshClickedPosition, hitPosition: hitResult.point };
  }

  setTargetAndFixPosition = (position?: Vector3): void => {
    const { flycam } = Store.getState();
    const { controls } = this;
    position = position || getPosition(flycam);
    const nmPosition = voxelToUnit(this.props.voxelSize, position);

    const camera = this.props.cameras[OrthoViews.TDView];
    if (camera instanceof PerspectiveCamera) {
      // For a perspective camera, relocating the rotation pivot to the new center (the flycam
      // position) must NOT move or reorient the camera: doing so would visibly shift the
      // world-fixed meshes (and cause a jump when hovering the viewport after moving elsewhere).
      // Instead we keep the rendered image completely untouched and only slide the trackball target
      // along the current view axis to the point closest to the new center. This keeps the
      // orientation consistent (no snap when the user starts rotating) while keeping the pivot near
      // the center.
      const changed =
        nmPosition[0] !== this.oldUnitPos[0] ||
        nmPosition[1] !== this.oldUnitPos[1] ||
        nmPosition[2] !== this.oldUnitPos[2];
      if (!changed) return;
      this.oldUnitPos = nmPosition;
      if (controls != null) {
        const viewDirection = controls.target.clone().sub(camera.position).normalize();
        const cameraToCenter = new ThreeVector3(...nmPosition).sub(camera.position);
        const depth = cameraToCenter.dot(viewDirection);
        // Only update the pivot if the new center is in front of the camera (avoids collapsing the
        // target onto the camera position).
        if (depth > 0) {
          const newTarget = camera.position.clone().add(viewDirection.multiplyScalar(depth));
          controls.target.copy(newTarget);
          controls.lastTarget = newTarget.clone();
        }
      }
      return;
    }

    if (controls != null) {
      controls.target.set(...nmPosition);
      controls.update();
    }

    // The following code is a dirty hack. If someone figures out
    // how the trackball control's target can be set without affecting
    // the camera position, go ahead.
    // As the previous step will also move the camera, we need to
    // fix this by offsetting the viewport
    const invertedDiff = [];

    for (let i = 0; i <= 2; i++) {
      invertedDiff.push(this.oldUnitPos[i] - nmPosition[i]);
    }

    if (invertedDiff.every((el) => el === 0)) return;
    this.oldUnitPos = nmPosition;
    const nmVector = new ThreeVector3(...invertedDiff);
    // moves camera by the nm vector
    const rotation = ThreeVector3.prototype.multiplyScalar.call(camera.rotation.clone(), -1);
    // reverse euler order
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'order' does not exist on type 'Vector3'.
    rotation.order = rotation.order.split("").reverse().join("");
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'Vector3' is not assignable to pa... Remove this comment to see the full error message
    nmVector.applyEuler(rotation);
    Store.dispatch(moveTDViewByVectorWithoutTimeTrackingAction(nmVector.x, nmVector.y));
  };

  zoomTDView(value: number, zoomToMouse: boolean = true): void {
    if (this.props.cameras[OrthoViews.TDView] instanceof PerspectiveCamera) {
      this.zoomPerspective(value);
      return;
    }
    let zoomToPosition;

    if (zoomToMouse && this.mouseController) {
      zoomToPosition = this.mouseController.position;
    }

    const { width, height } = getInputCatcherRect(Store.getState(), OrthoViews.TDView);
    Store.dispatch(zoomTDViewAction(value, zoomToPosition, width, height));
  }

  // Dollies the perspective camera towards/away from the world point under the cursor, so that
  // point stays fixed on screen (matching the orthographic zoom-to-cursor behaviour).
  zoomPerspective(value: number): void {
    const camera = this.props.cameras[OrthoViews.TDView];
    if (this.controls == null || !(camera instanceof PerspectiveCamera)) return;

    const factor = 0.9 ** value;
    const target = this.controls.target.clone();
    const position = camera.position.clone();

    // The anchor is the world point we zoom towards. By default it is the look-at target; if the
    // cursor is over the viewport we use the point under the cursor (on the plane through the
    // target, perpendicular to the view direction).
    let anchor = target.clone();
    const rect = getInputCatcherRect(Store.getState(), OrthoViews.TDView);
    const mouse = this.mouseController?.position;
    if (mouse != null && rect.width > 0 && rect.height > 0) {
      const ndc = new ThreeVector2(
        (mouse.x / rect.width) * 2 - 1,
        -((mouse.y / rect.height) * 2 - 1),
      );
      this.raycaster.setFromCamera(ndc, camera);
      const viewDirection = target.clone().sub(position).normalize();
      const plane = new ThreePlane().setFromNormalAndCoplanarPoint(viewDirection, target);
      const hit = new ThreeVector3();
      if (this.raycaster.ray.intersectPlane(plane, hit) != null) {
        anchor = hit;
      }
    }

    const newPosition = anchor.clone().add(position.clone().sub(anchor).multiplyScalar(factor));
    const newTarget = anchor.clone().add(target.clone().sub(anchor).multiplyScalar(factor));

    // Clamp the resulting distance so the camera never crosses its near/far planes.
    const minDistance = camera.near * 2;
    const maxDistance = camera.far * 0.9;
    const distance = newPosition.distanceTo(newTarget);
    if (distance < minDistance || distance > maxDistance) {
      const direction = newPosition.clone().sub(newTarget);
      if (direction.lengthSq() > 0) {
        direction.setLength(clamp(minDistance, distance, maxDistance));
        newPosition.copy(newTarget).add(direction);
      }
    }

    this.applyPerspectiveCamera(newPosition, newTarget, true);
  }

  moveTDView(delta: Point2): void {
    if (this.props.cameras[OrthoViews.TDView] instanceof PerspectiveCamera) {
      this.panPerspective(delta);
      return;
    }
    const [scaleX, scaleY] = getViewportScale(Store.getState(), OrthoViews.TDView);
    Store.dispatch(moveTDViewXAction((delta.x / scaleX) * -1));
    Store.dispatch(moveTDViewYAction((delta.y / scaleY) * -1));
  }

  // Pans the perspective camera by translating both the camera and its look-at target within the
  // screen plane, so the orientation (and rotation pivot) is preserved.
  panPerspective(delta: Point2): void {
    const camera = this.props.cameras[OrthoViews.TDView];
    if (this.controls == null || !(camera instanceof PerspectiveCamera)) return;

    const rect = getInputCatcherRect(Store.getState(), OrthoViews.TDView);
    if (rect.height === 0) return;

    const target = this.controls.target.clone();
    const position = camera.position.clone();
    const distance = position.distanceTo(target);
    const worldPerPixel = getFrustumHeightForPerspectiveDistance(distance) / rect.height;

    const forward = target.clone().sub(position).normalize();
    const right = new ThreeVector3().crossVectors(forward, camera.up).normalize();
    const up = new ThreeVector3().crossVectors(right, forward).normalize();
    const panVector = right
      .multiplyScalar(-delta.x * worldPerPixel)
      .add(up.multiplyScalar(delta.y * worldPerPixel));

    this.applyPerspectiveCamera(position.add(panVector), target.add(panVector), true);
  }

  // Applies a new position/target to the perspective TDView camera, keeps the trackball controls
  // in sync, and writes the result into the store.
  applyPerspectiveCamera(
    newPosition: ThreeVector3,
    newTarget: ThreeVector3,
    userTriggered: boolean,
  ): void {
    const camera = this.props.cameras[OrthoViews.TDView];
    if (this.controls != null) {
      this.controls.target.copy(newTarget);
      this.controls.lastTarget = newTarget.clone();
    }
    camera.position.copy(newPosition);
    camera.lookAt(newTarget);
    camera.updateProjectionMatrix();
    this.onTDCameraChanged(userTriggered);
  }

  onCameraModeChanged = (mode: TDViewCameraMode): void => {
    const { planeView } = this.props;
    if (planeView == null) return;

    const state = Store.getState();
    const oldCamera = this.props.cameras[OrthoViews.TDView];
    const wasPerspective = oldCamera instanceof PerspectiveCamera;
    const willBePerspective = mode === TDViewCameraModeEnum.PERSPECTIVE;
    if (wasPerspective === willBePerspective) return;

    const target =
      this.controls != null
        ? this.controls.target.clone()
        : new ThreeVector3(...voxelToUnit(this.props.voxelSize, getPosition(state.flycam)));
    const position = oldCamera.position.clone();
    const up = oldCamera.up.clone();
    const far = getTDViewFar(state);
    const aspectRatio = getInputCatcherAspectRatio(state, OrthoViews.TDView);

    let cameraData: PartialCameraData;
    if (willBePerspective) {
      // Convert the orthographic frustum height into the equivalent perspective camera distance,
      // so the apparent zoom is preserved across the switch.
      const storeCamera = state.viewModeData.plane.tdCamera;
      const height = storeCamera.top - storeCamera.bottom;
      const distance = getPerspectiveDistanceForFrustumHeight(height);
      let direction = position.clone().sub(target);
      if (direction.lengthSq() === 0) {
        direction = new ThreeVector3(1, 1, -0.5);
      }
      direction.setLength(distance);
      const newPosition = target.clone().add(direction);
      cameraData = {
        position: [newPosition.x, newPosition.y, newPosition.z],
        up: [up.x, up.y, up.z],
        near: getTDViewNear(far, true),
        far,
      };
    } else {
      // Convert the perspective camera distance into the equivalent orthographic frustum.
      const distance = position.distanceTo(target);
      const height = getFrustumHeightForPerspectiveDistance(distance);
      const width = height * aspectRatio;
      cameraData = {
        position: [position.x, position.y, position.z],
        up: [up.x, up.y, up.z],
        left: -width / 2,
        right: width / 2,
        top: height / 2,
        bottom: -height / 2,
        near: getTDViewNear(far, false),
        far,
      };
    }

    // Swap the underlying three.js camera (re-parenting the lights), rebind the trackball controls
    // to the new instance, and push the converted camera data through the store.
    const newCamera = planeView.setTDCameraMode(mode);
    newCamera.near = cameraData.near as number;
    newCamera.far = cameraData.far as number;
    newCamera.updateProjectionMatrix();
    if (this.controls != null) {
      this.controls.object = newCamera;
    }
    Store.dispatch(setTDCameraWithoutTimeTrackingAction(cameraData));
  };

  onTDCameraChanged = (userTriggered: boolean = true) => {
    const tdCamera = this.props.cameras[OrthoViews.TDView];
    const setCameraAction = userTriggered
      ? setTDCameraAction
      : setTDCameraWithoutTimeTrackingAction;
    // Write threeJS camera into store
    Store.dispatch(setCameraAction(threeCameraToCameraData(tdCamera)));
  };

  render() {
    return (
      <CameraController
        cameras={this.props.cameras}
        onCameraPositionChanged={this.updateControls}
        setTargetAndFixPosition={this.setTargetAndFixPosition}
        onTDCameraChanged={this.onTDCameraChanged}
      />
    );
  }
}

function mapStateToProps(state: WebknossosState): StateProps {
  return {
    voxelSize: state.dataset.dataSource.scale,
    activeTool: state.uiInformation.activeTool,
  };
}
const connector = connect(mapStateToProps);
export default connector(TDController);
