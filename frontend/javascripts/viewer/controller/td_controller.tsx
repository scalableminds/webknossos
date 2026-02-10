import { InputMouse } from "libs/input";
import { V3 } from "libs/mjs";
import TrackballControls from "libs/trackball_controls";
import { clamp, waitForElementWithId } from "libs/utils";
import get from "lodash-es/get";
import { PureComponent } from "react";
import { connect } from "react-redux";
import { type OrthographicCamera, type PerspectiveCamera, Vector3 as ThreeVector3 } from "three";
import type { VoxelSize } from "types/api_types";
import {
  type OrthoView,
  type OrthoViewMap,
  OrthoViews,
  type Point2,
  type Vector3,
} from "viewer/constants";
import CameraController from "viewer/controller/camera_controller";
import { handleOpenContextMenu } from "viewer/controller/combinations/skeleton_handlers";
import {
  ProofreadToolController,
  SkeletonToolController,
} from "viewer/controller/combinations/tool_controls";
import { getPosition } from "viewer/model/accessors/flycam_accessor";
import { getActiveNode, getNodePosition } from "viewer/model/accessors/skeletontracing_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { getInputCatcherRect, getViewportScale } from "viewer/model/accessors/view_mode_accessor";
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
import { voxelToUnit } from "viewer/model/scaleinfo";
import type { CameraData, StoreAnnotation, WebknossosState } from "viewer/store";
import Store from "viewer/store";
import type PlaneView from "viewer/view/plane_view";

const objToArr = ({ x, y, z }: { x: number; y: number; z: number }): Vector3 => [x, y, z];

function getCameraBasis(camera: OrthographicCamera | PerspectiveCamera) {
  const forward = new ThreeVector3();
  camera.getWorldDirection(forward);
  const up = camera.up.clone().normalize();
  const right = new ThreeVector3().crossVectors(forward, up).normalize();
  const correctedUp = new ThreeVector3().crossVectors(right, forward).normalize();
  return { right, up: correctedUp };
}

function getTDViewPanOffset(
  camera: OrthographicCamera | PerspectiveCamera,
  cameraData: CameraData,
): ThreeVector3 {
  const centerX = (cameraData.left + cameraData.right) / 2;
  const centerY = (cameraData.top + cameraData.bottom) / 2;
  if (centerX === 0 && centerY === 0) {
    return new ThreeVector3(0, 0, 0);
  }
  const { right, up } = getCameraBasis(camera);
  return right.multiplyScalar(centerX).add(up.multiplyScalar(centerY));
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
  cameras: OrthoViewMap<OrthographicCamera | PerspectiveCamera>;
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

  componentDidMount() {
    const { dataset, flycam } = Store.getState();
    this.oldUnitPos = voxelToUnit(dataset.dataSource.scale, getPosition(flycam));
    this.isStarted = true;
    this.initMouse();
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
    const cameraData = Store.getState().viewModeData.plane.tdCamera;
    const tdCamera = this.props.cameras[OrthoViews.TDView];
    const offset = getTDViewPanOffset(tdCamera, cameraData);
    const target = new ThreeVector3(...(cameraData.target || [0, 0, 0])).add(offset);
    this.controls.target.copy(target);
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
    const hitResult = this.props.planeView.performMeshHitTest([pos.x, pos.y]);
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
    const camera = this.props.cameras[OrthoViews.TDView];
    const rotation = ThreeVector3.prototype.multiplyScalar.call(camera.rotation.clone(), -1);
    // reverse euler order
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'order' does not exist on type 'Vector3'.
    rotation.order = rotation.order.split("").reverse().join("");
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'Vector3' is not assignable to pa... Remove this comment to see the full error message
    nmVector.applyEuler(rotation);
    Store.dispatch(moveTDViewByVectorWithoutTimeTrackingAction(nmVector.x, nmVector.y));
  };

  zoomTDView(value: number, zoomToMouse: boolean = true): void {
    let zoomToPosition;

    if (zoomToMouse && this.mouseController) {
      zoomToPosition = this.mouseController.position;
    }

    const { width, height } = getInputCatcherRect(Store.getState(), OrthoViews.TDView);
    Store.dispatch(zoomTDViewAction(value, zoomToPosition, width, height));
  }

  moveTDView(delta: Point2): void {
    const [scaleX, scaleY] = getViewportScale(Store.getState(), OrthoViews.TDView);
    Store.dispatch(moveTDViewXAction((delta.x / scaleX) * -1));
    Store.dispatch(moveTDViewYAction((delta.y / scaleY) * -1));
  }

  onTDCameraChanged = (userTriggered: boolean = true) => {
    const tdCamera = this.props.cameras[OrthoViews.TDView];
    const setCameraAction = userTriggered
      ? setTDCameraAction
      : setTDCameraWithoutTimeTrackingAction;
    const prevCameraData = Store.getState().viewModeData.plane.tdCamera;
    const offset = getTDViewPanOffset(tdCamera, prevCameraData);
    const basePosition = tdCamera.position.clone().sub(offset);
    const baseTarget =
      this.controls != null
        ? this.controls.target.clone().sub(offset)
        : new ThreeVector3(...prevCameraData.target);
    // Write threeJS camera into store
    Store.dispatch(
      setCameraAction({
        ...prevCameraData,
        near: tdCamera.near,
        far: tdCamera.far,
        position: objToArr(basePosition),
        up: objToArr(tdCamera.up),
        target: objToArr(baseTarget),
      }),
    );
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
