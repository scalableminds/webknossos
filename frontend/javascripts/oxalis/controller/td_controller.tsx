import { connect } from "react-redux";
import * as React from "react";
import * as THREE from "three";
import { InputMouse } from "libs/input";
import constants, {
  OrthoView,
  Point2,
  Vector3,
  OrthoViewCameraMap,
  TDCameras,
  AnnotationTool,
  AnnotationToolEnum,
  OrthoViews,
  ShowContextMenuFunction,
} from "oxalis/constants";
import { V3 } from "libs/mjs";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import {
  getViewportScale,
  getInputCatcherRect,
  getTDViewportSize,
} from "oxalis/model/accessors/view_mode_accessor";
import { setPositionAction } from "oxalis/model/actions/flycam_actions";
import { getVisibleSegmentationLayer } from "oxalis/model/accessors/dataset_accessor";
import {
  setViewportAction,
  setTDCameraAction,
  setTDCameraWithoutTimeTrackingAction,
  zoomTDViewAction,
  moveTDViewToPositionWithoutTimeTrackingAction,
} from "oxalis/model/actions/view_mode_actions";
import { getActiveNode } from "oxalis/model/accessors/skeletontracing_accessor";
import { voxelToNm } from "oxalis/model/scaleinfo";
import CameraController, { resetTrackballsEmitter } from "oxalis/controller/camera_controller";
import PlaneView from "oxalis/view/plane_view";
import type { CameraData, Flycam, OxalisState, Tracing } from "oxalis/store";
import Store from "oxalis/store";
import TrackballControls from "libs/trackball_controls";
import * as Utils from "libs/utils";
import { removeIsosurfaceAction } from "oxalis/model/actions/annotation_actions";
import { ProofreadTool, SkeletonTool } from "oxalis/controller/combinations/tool_controls";
import { handleOpenContextMenu } from "oxalis/controller/combinations/skeleton_handlers";

export function threeCameraToCameraData(camera: THREE.OrthographicCamera): CameraData {
  const { position, up, near, far, left, right, top, bottom } = camera;

  const objToArr = ({ x, y, z }: { x: number; y: number; z: number }): Vector3 => [x, y, z];

  return {
    left,
    right,
    top,
    bottom,
    near,
    far,
    xDiff: 0,
    yDiff: 0,
    position: objToArr(position),
    up: objToArr(up),
    lookAt: undefined,
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
        : SkeletonTool.onLegacyLeftClick(
            planeView,
            pos,
            event.shiftKey,
            event.altKey,
            event.ctrlKey,
            OrthoViews.TDView,
            isTouch,
          ),
  };
}

const INVALID_ACTIVE_NODE_ID = -1;
type OwnProps = {
  cameras: OrthoViewCameraMap;
  planeView?: PlaneView;
  tracing?: Tracing;
  showContextMenuAt?: ShowContextMenuFunction;
};
type StateProps = {
  flycam: Flycam;
  scale: Vector3;
  activeTool: AnnotationTool;
};
type Props = OwnProps & StateProps;

function maybeGetActiveNodeFromProps(props: Props) {
  return props.tracing && props.tracing.skeleton && props.tracing.skeleton.activeNodeId != null
    ? props.tracing.skeleton.activeNodeId
    : INVALID_ACTIVE_NODE_ID;
}

class TDController extends React.PureComponent<Props> {
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'controls' has no initializer and is not ... Remove this comment to see the full error message
  controls: [TrackballControls, TrackballControls];
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'mouseController' has no initializer and ... Remove this comment to see the full error message
  mouseController: InputMouse;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'oldNmPos' has no initializer and is not ... Remove this comment to see the full error message
  oldNmPos: Vector3;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'isStarted' has no initializer and is not... Remove this comment to see the full error message
  isStarted: boolean;
  unbindFromEmitter: () => void = () => {};

  componentDidMount() {
    const { dataset, flycam } = Store.getState();
    this.oldNmPos = voxelToNm(dataset.dataSource.scale, getPosition(flycam));
    this.isStarted = true;
    this.initMouse();
    this.unbindFromEmitter = resetTrackballsEmitter.on("reset", () =>
      this.resetTrackballControls(),
    );
  }

  componentDidUpdate(prevProps: Props) {
    if (
      maybeGetActiveNodeFromProps(this.props) !== maybeGetActiveNodeFromProps(prevProps) &&
      maybeGetActiveNodeFromProps(this.props) !== INVALID_ACTIVE_NODE_ID &&
      this.props.tracing &&
      this.props.tracing.skeleton
    ) {
      // The rotation center of this viewport is not updated to the new position after selecting a node in the viewport.
      // This happens because the selection of the node does not trigger a call to setTargetAndFixPosition directly.
      // Thus we do it manually whenever the active node changes.
      getActiveNode(this.props.tracing.skeleton).map((activeNode) =>
        this.setTargetAndFixPosition(activeNode.position),
      );
    }
  }

  componentWillUnmount() {
    this.isStarted = false;

    if (this.mouseController != null) {
      this.mouseController.destroy();
    }
    this.unbindFromEmitter();
    if (this.controls != null) {
      this.controls.forEach((control) => control.destroy());
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

  resetTrackballControls() {
    console.log("resetting trackball controls");
    this.controls.forEach((control) => {
      control.destroy();
    });
    const tdView = OrthoViews.TDView;
    const inputcatcherId = `inputcatcher_${tdView}`;
    Utils.waitForElementWithId(inputcatcherId).then((view) => {
      if (!this.isStarted) {
        return;
      }
      this.initTrackballControls(view);
    });
  }

  initTrackballControls(view: HTMLElement): void {
    const pos = voxelToNm(this.props.scale, getPosition(this.props.flycam));
    const { OrthographicCamera, PerspectiveCamera } = this.props.cameras[OrthoViews.TDView];
    console.log("performed init of trackball");
    // TODO: ensure "onTDCameraChanged is only called once"
    this.controls = [
      new TrackballControls(
        OrthographicCamera,
        view,
        new THREE.Vector3(...pos),
        this.onTDCameraChanged,
      ),
      new TrackballControls(
        PerspectiveCamera,
        view,
        new THREE.Vector3(...pos),
        this.onTDCameraChanged,
      ),
    ];
    this.controls.forEach((control) => {
      control.noZoom = true;
      control.staticMoving = true;
      control.panSpeed = 1;
      // !!! target is set here !!!
      control.target.set(...pos);
    });
    // This is necessary, since we instantiated this.controls now. This should be removed
    // when the workaround with requestAnimationFrame(initInputHandlers) is removed.
    this.forceUpdate();
  }

  updateControls = () => {
    if (!this.controls) {
      return;
    }
    // TODO:
    // Make the fly cam the rotation center
    // The camera teleports to the center when clicking one of the buttons.
    // Likely the position and so in the store is not up to date with the camera.
    // return;
    const flycamPos = voxelToNm(this.props.scale, getPosition(this.props.flycam));
    this.controls.forEach((control) => {
      control.flycamPos.set(...flycamPos);
      control.update(true);
    });
  };

  getTDViewMouseControls(): Record<string, any> {
    const skeletonControls =
      this.props.tracing != null &&
      this.props.tracing.skeleton != null &&
      this.props.planeView != null
        ? getTDViewMouseControlsSkeleton(this.props.planeView)
        : null;
    const controls = {
      leftDownMove: (delta: Point2) => this.moveTDView(delta),
      scroll: (value: number) => this.zoomTDView(Utils.clamp(-1, value, 1), true),
      over: () => {
        Store.dispatch(setViewportAction(OrthoViews.TDView));
        // Fix the rotation target of the TrackballControls
        // this.setTargetAndFixPosition();
      },
      // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'delta' implicitly has an 'any' type.
      pinch: (delta) => this.zoomTDView(delta, true),
      mouseMove: (delta: Point2, position: Point2) => {
        if (this.props.planeView == null) {
          return;
        }

        this.props.planeView.throttledPerformIsosurfaceHitTest([position.x, position.y]);
      },
      leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        if (skeletonControls != null) {
          skeletonControls.leftClick(pos, plane, event, isTouch, this.props.activeTool);
        }

        if (this.props.planeView == null) {
          return;
        }

        if (!event.shiftKey && !event.ctrlKey) {
          // No modifiers were pressed. No mesh related action is necessary.
          return;
        }

        const hitPosition = this.props.planeView.performIsosurfaceHitTest([pos.x, pos.y]);

        if (!hitPosition) {
          return;
        }

        const unscaledPosition = V3.divide3(hitPosition.toArray() as Vector3, this.props.scale);

        if (event.shiftKey) {
          Store.dispatch(setPositionAction(unscaledPosition));
        } else if (event.ctrlKey) {
          const storeState = Store.getState();
          const { hoveredSegmentId } = storeState.temporaryConfiguration;
          const segmentationLayer = getVisibleSegmentationLayer(storeState);

          if (!segmentationLayer) {
            return;
          }

          Store.dispatch(removeIsosurfaceAction(segmentationLayer.name, hoveredSegmentId));
        }
      },
      rightClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        if (this.props.planeView == null || this.props.showContextMenuAt == null) return;

        handleOpenContextMenu(
          this.props.planeView,
          pos,
          plane,
          isTouch,
          event,
          this.props.showContextMenuAt,
        );
      },
    };
    return controls;
  }

  updateTDPositionAfterMovement(x: number, y: number) {
    const storeState = Store.getState();
    const flycamPos = voxelToNm(
      storeState.dataset.dataSource.scale,
      getPosition(storeState.flycam),
    );
    const flycamVector = new THREE.Vector3(...flycamPos);
    const tdPerspectiveCamera = this.props.cameras[OrthoViews.TDView][TDCameras.PerspectiveCamera];
    const directionToFlyCam = new THREE.Vector3(...flycamPos);
    directionToFlyCam.subVectors(tdPerspectiveCamera.position, flycamVector);
    const cameraMovementVector = new THREE.Vector3(0, 0, -1).applyQuaternion(
      tdPerspectiveCamera.quaternion,
    );
    cameraMovementVector.cross(tdPerspectiveCamera.up).setLength(x);
    cameraMovementVector.add(tdPerspectiveCamera.up.clone().setLength(y));
    tdPerspectiveCamera.position.add(cameraMovementVector);

    tdPerspectiveCamera.updateProjectionMatrix();
    this.props.cameras[OrthoViews.TDView][TDCameras.OrthographicCamera].position.add(
      cameraMovementVector,
    );
    this.props.cameras[OrthoViews.TDView][TDCameras.OrthographicCamera].updateProjectionMatrix();
    // console.log(this.props.cameras[OrthoViews.TDView][TDCameras.OrthographicCamera]);
  }

  setTargetAndFixPosition = (position?: Vector3): void => {
    const { controls } = this;
    position = position || getPosition(this.props.flycam);
    const nmPosition = voxelToNm(this.props.scale, position);
    if (controls != null) {
      this.controls.forEach((control) => {
        control.target.set(...nmPosition);
        control.update();
      });
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
    const { OrthographicCamera } = this.props.cameras[OrthoViews.TDView];
    const rotation: THREE.Euler = THREE.Vector3.prototype.multiplyScalar.call(
      OrthographicCamera.rotation.clone(),
      -1,
    ) as any as THREE.Euler;
    // reverse euler order
    rotation.order = rotation.order.split("").reverse().join("");
    nmVector.applyEuler(rotation);
    // TODO: here
    // this.updateTDPositionAfterMovement(nmVector.x, nmVector.y);
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
    console.log("I would be moved now....");
    /*const storeState = Store.getState();
    let [scaleX, scaleY] = getViewportScale(Store.getState(), OrthoViews.TDView);
    scaleX = delta.x / scaleX;
    scaleY = -delta.y / scaleY;
    scaleX *= getTDViewportSize(storeState)[0] / constants.VIEWPORT_WIDTH;
    scaleY *= (-1 * getTDViewportSize(storeState)[1]) / constants.VIEWPORT_WIDTH;
    this.updateTDPositionAfterMovement(scaleX, scaleY);*/
  }

  onTDCameraChanged = (userTriggered: boolean = true) => {
    const { OrthographicCamera } = this.props.cameras[OrthoViews.TDView];
    const setCameraAction = userTriggered
      ? setTDCameraAction
      : setTDCameraWithoutTimeTrackingAction;
    // Write threeJS camera into store
    Store.dispatch(setCameraAction(threeCameraToCameraData(OrthographicCamera)));
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
