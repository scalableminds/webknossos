// @flow
import * as React from "react";
import * as Utils from "libs/utils";
import { InputMouse } from "libs/input";
import { getViewportScale, getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import CameraController from "oxalis/controller/camera_controller";
import { voxelToNm } from "oxalis/model/scaleinfo";
import TrackballControls from "libs/trackball_controls";
import Store from "oxalis/store";
import type { OxalisState, Flycam, CameraData, Tracing } from "oxalis/store";
import * as THREE from "three";
import { OrthoViews, type Vector3 } from "oxalis/constants";
import type { Point2, OrthoViewMap } from "oxalis/constants";
import { connect } from "react-redux";
import {
  setViewportAction,
  setTDCameraAction,
  zoomTDViewAction,
  moveTDViewXAction,
  moveTDViewYAction,
  moveTDViewByVectorAction,
} from "oxalis/model/actions/view_mode_actions";
import PlaneView from "oxalis/view/plane_view";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import * as skeletonController from "oxalis/controller/combinations/skeletontracing_plane_controller";

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

type OwnProps = {|
  cameras: OrthoViewMap<THREE.OrthographicCamera>,
  planeView?: PlaneView,
  tracing?: Tracing,
|};

type Props = {
  ...OwnProps,
  flycam: Flycam,
  scale: Vector3,
};

class TDController extends React.PureComponent<Props> {
  controls: TrackballControls;
  mouseController: InputMouse;
  oldNmPos: Vector3;
  isStarted: boolean;

  componentDidMount() {
    const { dataset, flycam } = Store.getState();
    this.oldNmPos = voxelToNm(dataset.dataSource.scale, getPosition(flycam));
    this.isStarted = true;

    this.initMouse();
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
    const inputcatcherSelector = `#inputcatcher_${tdView}`;
    Utils.waitForSelector(inputcatcherSelector).then(view => {
      if (!this.isStarted) {
        return;
      }
      this.mouseController = new InputMouse(
        inputcatcherSelector,
        this.getTDViewMouseControls(),
        tdView,
      );
      this.initTrackballControls(view);
    });
  }

  initTrackballControls(view): void {
    const pos = voxelToNm(this.props.scale, getPosition(this.props.flycam));
    const tdCamera = this.props.cameras[OrthoViews.TDView];
    this.controls = new TrackballControls(tdCamera, view, new THREE.Vector3(...pos), () => {
      // write threeJS camera into store
      Store.dispatch(setTDCameraAction(threeCameraToCameraData(tdCamera)));
    });

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
    const baseControls = {
      leftDownMove: (delta: Point2) => this.moveTDView(delta),
      scroll: (value: number) => this.zoomTDView(Utils.clamp(-1, value, 1), true),
      over: () => {
        Store.dispatch(setViewportAction(OrthoViews.TDView));
        // Fix the rotation target of the TrackballControls
        this.setTargetAndFixPosition();
      },
      pinch: delta => this.zoomTDView(delta, true),
    };

    const skeletonControls =
      this.props.tracing != null &&
      this.props.tracing.skeleton != null &&
      this.props.planeView != null
        ? skeletonController.getTDViewMouseControls(this.props.planeView)
        : {};

    return {
      ...baseControls,
      ...skeletonControls,
    };
  }

  setTargetAndFixPosition(): void {
    const position = getPosition(this.props.flycam);
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

    Store.dispatch(moveTDViewByVectorAction(nmVector.x, nmVector.y));
  }

  zoomTDView(value: number, zoomToMouse: boolean = true): void {
    let zoomToPosition;
    if (zoomToMouse && this.mouseController) {
      zoomToPosition = this.mouseController.position;
    }
    const { width } = getInputCatcherRect(OrthoViews.TDView);
    Store.dispatch(zoomTDViewAction(value, zoomToPosition, width));
  }

  moveTDView(delta: Point2): void {
    const scale = getViewportScale(OrthoViews.TDView);
    Store.dispatch(moveTDViewXAction((delta.x / scale) * -1));
    Store.dispatch(moveTDViewYAction((delta.y / scale) * -1));
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

export function mapStateToProps(state: OxalisState, ownProps: OwnProps): Props {
  return {
    ...ownProps,
    flycam: state.flycam,
    scale: state.dataset.dataSource.scale,
  };
}

export default connect(mapStateToProps)(TDController);
