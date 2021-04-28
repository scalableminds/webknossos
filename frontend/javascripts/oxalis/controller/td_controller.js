// @flow
import { connect } from "react-redux";
import * as React from "react";
import * as THREE from "three";

import { InputMouse } from "libs/input";
import {
  type OrthoView,
  type OrthoViewMap,
  OrthoViews,
  type Point2,
  type Vector3,
} from "oxalis/constants";
import { V3 } from "libs/mjs";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import { getViewportScale, getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import { setPositionAction } from "oxalis/model/actions/flycam_actions";
import {
  setViewportAction,
  setTDCameraAction,
  setTDCameraWithoutTimeTrackingAction,
  zoomTDViewAction,
  moveTDViewXAction,
  moveTDViewYAction,
  moveTDViewByVectorWithoutTimeTrackingAction,
} from "oxalis/model/actions/view_mode_actions";
import { getActiveNode } from "oxalis/model/accessors/skeletontracing_accessor";
import { voxelToNm } from "oxalis/model/scaleinfo";
import CameraController from "oxalis/controller/camera_controller";
import PlaneView from "oxalis/view/plane_view";
import Store, { type CameraData, type Flycam, type OxalisState, type Tracing } from "oxalis/store";
import TrackballControls from "libs/trackball_controls";
import * as Utils from "libs/utils";
import { removeIsosurfaceAction } from "oxalis/model/actions/annotation_actions";
import { SkeletonTool } from "oxalis/controller/combinations/tool_controls";

export function threeCameraToCameraData(camera: typeof THREE.OrthographicCamera): CameraData {
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

function getTDViewMouseControlsSkeleton(planeView: PlaneView): Object {
  return {
    leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) =>
      SkeletonTool.onLegacyLeftClick(
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

type OwnProps = {|
  cameras: OrthoViewMap<typeof THREE.OrthographicCamera>,
  planeView?: PlaneView,
  tracing?: Tracing,
|};
type StateProps = {|
  flycam: Flycam,
  scale: Vector3,
|};
type Props = { ...OwnProps, ...StateProps };

function maybeGetActiveNodeFromProps(props: Props) {
  return props.tracing && props.tracing.skeleton && props.tracing.skeleton.activeNodeId != null
    ? props.tracing.skeleton.activeNodeId
    : INVALID_ACTIVE_NODE_ID;
}

class TDController extends React.PureComponent<Props> {
  controls: typeof TrackballControls;
  mouseController: InputMouse;
  oldNmPos: Vector3;
  isStarted: boolean;

  componentDidMount() {
    const { dataset, flycam } = Store.getState();
    this.oldNmPos = voxelToNm(dataset.dataSource.scale, getPosition(flycam));
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
      getActiveNode(this.props.tracing.skeleton).map(activeNode =>
        this.setTargetAndFixPosition(activeNode.position),
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
    Utils.waitForElementWithId(inputcatcherId).then(view => {
      if (!this.isStarted) {
        return;
      }
      this.mouseController = new InputMouse(inputcatcherId, this.getTDViewMouseControls(), tdView);
      this.initTrackballControls(view);
    });
  }

  initTrackballControls(view: HTMLElement): void {
    const pos = voxelToNm(this.props.scale, getPosition(this.props.flycam));
    const tdCamera = this.props.cameras[OrthoViews.TDView];
    this.controls = new TrackballControls(
      tdCamera,
      view,
      new THREE.Vector3(...pos),
      (userTriggered: boolean = true) => {
        const setCameraAction = userTriggered
          ? setTDCameraAction
          : setTDCameraWithoutTimeTrackingAction;
        // write threeJS camera into store
        Store.dispatch(setCameraAction(threeCameraToCameraData(tdCamera)));
      },
    );

    this.controls.noZoom = true;
    this.controls.noPan = true;
    this.controls.staticMoving = true;

    this.controls.target.set(...pos);

    // This is necessary, since we instantiated this.controls now. This should be removed
    // when the workaround with requestAnimationFrame(initInputHandlers) is removed.
    this.forceUpdate();
  }

  updateControls = () => this.controls.update(true);

  getTDViewMouseControls(): Object {
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
        this.setTargetAndFixPosition();
      },
      pinch: delta => this.zoomTDView(delta, true),
      mouseMove: (delta: Point2, position: Point2) => {
        if (this.props.planeView == null) {
          return;
        }
        this.props.planeView.throttledPerformIsosurfaceHitTest([position.x, position.y]);
      },
      leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) => {
        if (skeletonControls != null) {
          skeletonControls.leftClick(pos, plane, event, isTouch);
        }

        if (this.props.planeView == null) {
          return;
        }

        if (!event.shiftKey && !event.ctrlKey) {
          // No modifiers were pressed. No isosurface related action is necessary.
          return;
        }

        const hitPosition = this.props.planeView.performIsosurfaceHitTest([pos.x, pos.y]);
        if (!hitPosition) {
          return;
        }
        const unscaledPosition = V3.divide3(hitPosition.toArray(), this.props.scale);

        if (event.shiftKey) {
          Store.dispatch(setPositionAction(unscaledPosition));
        } else if (event.ctrlKey) {
          const storeState = Store.getState();
          const { hoveredIsosurfaceId } = storeState.temporaryConfiguration;
          Store.dispatch(removeIsosurfaceAction(hoveredIsosurfaceId));
        }
      },
    };

    return controls;
  }

  setTargetAndFixPosition(position?: Vector3): void {
    position = position || getPosition(this.props.flycam);
    const nmPosition = voxelToNm(this.props.scale, position);

    this.controls.target.set(...nmPosition);
    this.controls.update();

    // The following code is a dirty hack. If someone figures out
    // how the trackball control's target can be set without affecting
    // the camera position, go ahead.
    // As the previous step will also move the camera, we need to
    // fix this by offsetting the viewport

    const invertedDiff = [];
    for (let i = 0; i <= 2; i++) {
      invertedDiff.push(this.oldNmPos[i] - nmPosition[i]);
    }

    if (invertedDiff.every(el => el === 0)) return;

    this.oldNmPos = nmPosition;

    const nmVector = new THREE.Vector3(...invertedDiff);
    // moves camera by the nm vector
    const camera = this.props.cameras[OrthoViews.TDView];

    const rotation = THREE.Vector3.prototype.multiplyScalar.call(camera.rotation.clone(), -1);
    // reverse euler order
    rotation.order = rotation.order
      .split("")
      .reverse()
      .join("");

    nmVector.applyEuler(rotation);

    Store.dispatch(moveTDViewByVectorWithoutTimeTrackingAction(nmVector.x, nmVector.y));
  }

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

  render() {
    if (!this.controls) {
      return null;
    }

    return (
      <CameraController
        cameras={this.props.cameras}
        onCameraPositionChanged={this.updateControls}
      />
    );
  }
}

export function mapStateToProps(state: OxalisState): StateProps {
  return {
    flycam: state.flycam,
    scale: state.dataset.dataSource.scale,
  };
}

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(TDController);
