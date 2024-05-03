import { connect } from "react-redux";
import * as React from "react";
import * as THREE from "three";
import { InputMouse } from "libs/input";
import {
  AnnotationTool,
  AnnotationToolEnum,
  OrthoView,
  OrthoViews,
  OrthoViewMap,
  Point2,
  ShowContextMenuFunction,
  Vector3,
} from "oxalis/constants";
import { V3 } from "libs/mjs";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import { getViewportScale, getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import { setPositionAction } from "oxalis/model/actions/flycam_actions";
import { getVisibleSegmentationLayer } from "oxalis/model/accessors/dataset_accessor";
import {
  setViewportAction,
  setTDCameraAction,
  setTDCameraWithoutTimeTrackingAction,
  zoomTDViewAction,
  moveTDViewXAction,
  moveTDViewYAction,
  moveTDViewByVectorWithoutTimeTrackingAction,
} from "oxalis/model/actions/view_mode_actions";
import { getActiveNode, getNodePosition } from "oxalis/model/accessors/skeletontracing_accessor";
import { voxelToDatasourceUnit } from "oxalis/model/scaleinfo";
import CameraController from "oxalis/controller/camera_controller";
import PlaneView from "oxalis/view/plane_view";
import type { CameraData, Flycam, OxalisState, Tracing } from "oxalis/store";
import Store from "oxalis/store";
import TrackballControls from "libs/trackball_controls";
import * as Utils from "libs/utils";
import { removeMeshAction } from "oxalis/model/actions/annotation_actions";
import { ProofreadTool, SkeletonTool } from "oxalis/controller/combinations/tool_controls";
import { handleOpenContextMenu } from "oxalis/controller/combinations/skeleton_handlers";
import { DatasetScale } from "types/api_flow_types";

export function threeCameraToCameraData(camera: THREE.OrthographicCamera): CameraData {
  const { position, up, near, far, lookAt, left, right, top, bottom } = camera;

  const objToArr = ({ x, y, z }: { x: number; y: number; z: number }): Vector3 => [x, y, z];

  return {
    left,
    right,
    top,
    bottom,
    near,
    far,
    position: objToArr(position),
    up: objToArr(up),
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '(vector: number | Vector3, y?: n... Remove this comment to see the full error message
    lookAt: objToArr(lookAt),
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
      activeTool === AnnotationToolEnum.PROOFREAD
        ? ProofreadTool.onLeftClick(planeView, pos, plane, event, isTouch)
        : SkeletonTool.onLeftClick(
            planeView,
            pos,
            event.shiftKey,
            event.altKey,
            event.ctrlKey || event.metaKey,
            OrthoViews.TDView,
            isTouch,
          ),
  };
}

const INVALID_ACTIVE_NODE_ID = -1;
type OwnProps = {
  cameras: OrthoViewMap<THREE.OrthographicCamera>;
  planeView?: PlaneView;
  tracing?: Tracing;
  showContextMenuAt?: ShowContextMenuFunction;
};
type StateProps = {
  flycam: Flycam;
  scale: DatasetScale;
  activeTool: AnnotationTool;
};
type Props = OwnProps & StateProps;

function maybeGetActiveNodeFromProps(props: Props) {
  return props.tracing?.skeleton?.activeNodeId != null
    ? props.tracing.skeleton.activeNodeId
    : INVALID_ACTIVE_NODE_ID;
}

class TDController extends React.PureComponent<Props> {
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'controls' has no initializer and is not ... Remove this comment to see the full error message
  controls: typeof TrackballControls;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'mouseController' has no initializer and ... Remove this comment to see the full error message
  mouseController: InputMouse;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'oldNmPos' has no initializer and is not ... Remove this comment to see the full error message
  oldNmPos: Vector3;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'isStarted' has no initializer and is not... Remove this comment to see the full error message
  isStarted: boolean;

  componentDidMount() {
    const { dataset, flycam } = Store.getState();
    this.oldNmPos = voxelToDatasourceUnit(dataset.dataSource.scale, getPosition(flycam));
    this.isStarted = true;
    this.initMouse();
  }

  componentDidUpdate(prevProps: Props) {
    if (
      maybeGetActiveNodeFromProps(this.props) !== maybeGetActiveNodeFromProps(prevProps) &&
      maybeGetActiveNodeFromProps(this.props) !== INVALID_ACTIVE_NODE_ID &&
      this.props.tracing &&
      this.props.tracing.skeleton
    ) {
      // The rotation center of this viewport is not updated to the new position after selecing a node in the viewport.
      // This happens because the selection of the node does not trigger a call to setTargetAndFixPosition directly.
      // Thus we do it manually whenever the active node changes.
      getActiveNode(this.props.tracing.skeleton).map((activeNode) =>
        this.setTargetAndFixPosition(getNodePosition(activeNode, Store.getState())),
      );
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
    Utils.waitForElementWithId(inputcatcherId).then((view) => {
      if (!this.isStarted) {
        return;
      }

      this.mouseController = new InputMouse(inputcatcherId, this.getTDViewMouseControls(), tdView);
      this.initTrackballControls(view);
    });
  }

  initTrackballControls(view: HTMLElement): void {
    const pos = voxelToDatasourceUnit(this.props.scale, getPosition(this.props.flycam));
    const tdCamera = this.props.cameras[OrthoViews.TDView];
    this.controls = new TrackballControls(
      tdCamera,
      view,
      new THREE.Vector3(...pos),
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
      this.props.tracing?.skeleton != null && this.props.planeView != null
        ? getTDViewMouseControlsSkeleton(this.props.planeView)
        : null;
    const controls = {
      leftDownMove: (delta: Point2) => this.moveTDView(delta),
      scroll: (value: number) => this.zoomTDView(Utils.clamp(-1, value, 1), true),
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

        this.props.planeView.throttledPerformMeshHitTest([position.x, position.y]);
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

        const intersection = this.props.planeView.performMeshHitTest([pos.x, pos.y]);

        if (!intersection) {
          return;
        }
        const { point: hitPosition } = intersection;

        const unscaledPosition = V3.divide3(
          hitPosition.toArray() as Vector3,
          this.props.scale.factor,
        );
        console.log(
          "TDController",
          "leftclick",
          "unscaledPosition",
          unscaledPosition,
          "scale factor",
          this.props.scale.factor,
        );

        if (event.shiftKey) {
          Store.dispatch(setPositionAction(unscaledPosition));
        } else if (ctrlOrMetaPressed) {
          const storeState = Store.getState();
          const { hoveredSegmentId } = storeState.temporaryConfiguration;
          const segmentationLayer = getVisibleSegmentationLayer(storeState);

          if (!segmentationLayer || hoveredSegmentId == null) {
            return;
          }

          Store.dispatch(removeMeshAction(segmentationLayer.name, hoveredSegmentId));
        }
      },
      rightClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        if (this.props.planeView == null || this.props.showContextMenuAt == null) return;
        const intersection = this.props.planeView.performMeshHitTest([pos.x, pos.y]);
        // @ts-expect-error ts-migrate(2339) FIXME: Object is possibly 'null'.
        const meshId = intersection ? intersection.object.parent?.cellId : null;
        const meshClickedPosition = intersection ? (intersection.point.toArray() as Vector3) : null;
        handleOpenContextMenu(
          this.props.planeView,
          pos,
          plane,
          isTouch,
          event,
          this.props.showContextMenuAt,
          meshId,
          meshClickedPosition,
        );
      },
    };
    return controls;
  }

  setTargetAndFixPosition = (position?: Vector3): void => {
    const { controls } = this;
    position = position || getPosition(this.props.flycam);
    const nmPosition = voxelToDatasourceUnit(this.props.scale, position);

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
      invertedDiff.push(this.oldNmPos[i] - nmPosition[i]);
    }

    if (invertedDiff.every((el) => el === 0)) return;
    this.oldNmPos = nmPosition;
    const nmVector = new THREE.Vector3(...invertedDiff);
    // moves camera by the nm vector
    const camera = this.props.cameras[OrthoViews.TDView];
    const rotation = THREE.Vector3.prototype.multiplyScalar.call(camera.rotation.clone(), -1);
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
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'Point2 | null | undefined' is no... Remove this comment to see the full error message
    Store.dispatch(zoomTDViewAction(value, zoomToPosition, width, height));
  }

  moveTDView(delta: Point2): void {
    const [scaleX, scaleY] = getViewportScale(Store.getState(), OrthoViews.TDView);
    Store.dispatch(moveTDViewXAction((delta.x / scaleX) * -1));
    Store.dispatch(moveTDViewYAction((delta.y / scaleY) * -1));
  }

  onTDCameraChanged = (userTriggered: boolean = true) => {
    const tdCamera = this.props.cameras[OrthoViews.TDView];
    debugger;
    const setCameraAction = userTriggered
      ? setTDCameraAction
      : setTDCameraWithoutTimeTrackingAction;
    // Write threeJS camera into store
    console.log("TDController", "onTDCameraChanged", "tdCamera", tdCamera);
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

export function mapStateToProps(state: OxalisState): StateProps {
  return {
    flycam: state.flycam,
    scale: state.dataset.dataSource.scale,
    activeTool: state.uiInformation.activeTool,
  };
}
const connector = connect(mapStateToProps);
export default connector(TDController);
