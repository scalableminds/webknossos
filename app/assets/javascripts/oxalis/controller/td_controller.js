// @flow
import * as React from "react";
import * as Utils from "libs/utils";
import { InputKeyboard, InputMouse, InputKeyboardNoLoop } from "libs/input";
import { getViewportScale, getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import CameraController from "oxalis/controller/camera_controller";
import { voxelToNm, getBaseVoxel } from "oxalis/model/scaleinfo";
import TrackballControls from "libs/trackball_controls";
import Store from "oxalis/store";
import type { OxalisState, Flycam } from "oxalis/store";
import * as THREE from "three";
import constants, { OrthoViews, type Vector3 } from "oxalis/constants";
import type { Point2, OrthoViewMap } from "oxalis/constants";
import { connect } from "react-redux";
import {
  setViewportAction,
  setTDCameraAction,
  zoomTDViewAction,
  moveTDViewXAction,
  moveTDViewYAction,
} from "oxalis/model/actions/view_mode_actions";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import { threeCameraToCameraData } from "./viewmodes/plane_controller";

type OwnProps = {|
  cameras: OrthoViewMap<THREE.OrthographicCamera>,
|};

type Props = {
  ...OwnProps,
  flycam: Flycam,
  scale: Vector3,
};

class TDController extends React.PureComponent<Props> {
  controls: TrackballControls;
  mouseController: InputMouse;

  componentDidMount() {
    this.initMouse();
  }

  componentWillUnmount() {
    this.mouseController.destroy();
  }

  initMouse(): void {
    const tdView = OrthoViews.TDView;
    const inputcatcherSelector = `#inputcatcher_${tdView}`;
    Utils.waitForSelector(inputcatcherSelector).then(_domElement => {
      this.mouseController = new InputMouse(
        inputcatcherSelector,
        this.getTDViewMouseControls(),
        tdView,
      );
      this.initTrackballControls();
    });
  }

  initTrackballControls(): void {
    Utils.waitForSelector("#inputcatcher_TDView").then(view => {
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
    });
  }

  updateControls = () => this.controls.update(true);

  getTDViewMouseControls(): Object {
    return {
      leftDownMove: (delta: Point2) => this.moveTDView(delta),
      scroll: (value: number) => this.zoomTDView(Utils.clamp(-1, value, 1), true),
      over: () => {
        Store.dispatch(setViewportAction(OrthoViews.TDView));
      },
      pinch: delta => this.zoomTDView(delta, true),
    };
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
