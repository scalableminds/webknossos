/**
 * plane_controller.js
 * @flow
 */

import { connect } from "react-redux";
import BackboneEvents from "backbone-events-standalone";
import Clipboard from "clipboard-js";
import * as React from "react";
import * as THREE from "three";
import _ from "lodash";

import { InputKeyboard, InputKeyboardNoLoop, InputMouse, type ModifierKeys } from "libs/input";
import { document } from "libs/window";
import {
  getPosition,
  getRequestLogZoomStep,
  getPlaneScalingFactor,
} from "oxalis/model/accessors/flycam_accessor";
import { getResolutions } from "oxalis/model/accessors/dataset_accessor";
import { getViewportScale, getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import { getVolumeTool } from "oxalis/model/accessors/volumetracing_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import {
  movePlaneFlycamOrthoAction,
  moveFlycamOrthoAction,
  zoomByDeltaAction,
} from "oxalis/model/actions/flycam_actions";
import {
  setBrushSizeAction,
  setMousePositionAction,
} from "oxalis/model/actions/volumetracing_actions";
import {
  setViewportAction,
  setTDCameraAction,
  zoomTDViewAction,
  moveTDViewXAction,
  moveTDViewYAction,
  moveTDViewByVectorAction,
} from "oxalis/model/actions/view_mode_actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { voxelToNm, getBaseVoxel, getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import CameraController from "oxalis/controller/camera_controller";
import Dimensions from "oxalis/model/dimensions";
import Model from "oxalis/model";
import PlaneView from "oxalis/view/plane_view";
import SceneController from "oxalis/controller/scene_controller";
import Store, { type CameraData, type Flycam, type OxalisState, type Tracing } from "oxalis/store";
import Toast from "libs/toast";
import TrackballControls from "libs/trackball_controls";
import * as Utils from "libs/utils";
import api from "oxalis/api/internal_api";
import constants, {
  type OrthoView,
  type OrthoViewMap,
  OrthoViewValues,
  OrthoViewValuesWithoutTDView,
  OrthoViews,
  type Point2,
  type Vector3,
  VolumeToolEnum,
} from "oxalis/constants";
import messages from "messages";
import * as skeletonController from "oxalis/controller/combinations/skeletontracing_plane_controller";
import * as volumeController from "oxalis/controller/combinations/volumetracing_plane_controller";

function ensureNonConflictingHandlers(skeletonControls: Object, volumeControls: Object): void {
  const conflictingHandlers = _.intersection(
    Object.keys(skeletonControls),
    Object.keys(volumeControls),
  );
  if (conflictingHandlers.length > 0) {
    throw new Error(
      `There are unsolved conflicts between skeleton and volume controller: ${conflictingHandlers.join(
        ", ",
      )}`,
    );
  }
}

type OwnProps = {
  onRender: () => void,
};

type Props = OwnProps & {
  flycam: Flycam,
  scale: Vector3,
  tracing: Tracing,
};

class PlaneController extends React.PureComponent<Props> {
  // See comment in Controller class on general controller architecture.
  //
  // Plane Controller: Responsible for Plane Modes
  planeView: PlaneView;
  input: {
    mouseControllers: OrthoViewMap<InputMouse>,
    keyboard?: InputKeyboard,
    keyboardNoLoop?: InputKeyboardNoLoop,
    keyboardLoopDelayed?: InputKeyboard,
    keyboardNoLoop?: InputKeyboardNoLoop,
  };
  storePropertyUnsubscribers: Array<Function>;
  isStarted: boolean;
  oldNmPos: Vector3;
  zoomPos: Vector3;
  controls: TrackballControls;
  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;
  stopListening: Function;

  constructor(...args: any) {
    super(...args);
    _.extend(this, BackboneEvents);
    this.storePropertyUnsubscribers = [];
  }

  componentDidMount() {
    this.input = {
      mouseControllers: {},
    };
    this.isStarted = false;

    const state = Store.getState();
    this.oldNmPos = voxelToNm(state.dataset.dataSource.scale, getPosition(state.flycam));

    this.planeView = new PlaneView();

    Store.dispatch(setViewportAction(OrthoViews.PLANE_XY));

    this.start();
  }

  componentWillUnmount() {
    this.stop();
  }

  initMouse(): void {
    OrthoViewValues.forEach(id => {
      const inputcatcherSelector = `#inputcatcher_${OrthoViews[id]}`;
      Utils.waitForSelector(inputcatcherSelector).then(() => {
        this.input.mouseControllers[id] = new InputMouse(
          inputcatcherSelector,
          id !== OrthoViews.TDView ? this.getPlaneMouseControls(id) : this.getTDViewMouseControls(),
          id,
        );
      });
    });
  }

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
      this.props.tracing.skeleton != null
        ? skeletonController.getTDViewMouseControls(this.planeView)
        : {};

    return {
      ...baseControls,
      ...skeletonControls,
    };
  }

  getPlaneMouseControls(planeId: OrthoView): Object {
    const baseControls = {
      leftDownMove: (delta: Point2) => {
        const viewportScale = getViewportScale(planeId);
        return this.movePlane([(delta.x * -1) / viewportScale, (delta.y * -1) / viewportScale, 0]);
      },

      scroll: this.scrollPlanes.bind(this),
      over: () => {
        Store.dispatch(setViewportAction(planeId));
      },
      pinch: delta => this.zoom(delta, true),
      mouseMove: (delta: Point2, position: Point2) => {
        Store.dispatch(setMousePositionAction([position.x, position.y]));
      },
    };
    // TODO: Find a nicer way to express this, while satisfying flow
    const emptyDefaultHandler = { leftClick: null };
    const { leftClick: skeletonLeftClick, ...skeletonControls } =
      this.props.tracing.skeleton != null
        ? skeletonController.getPlaneMouseControls(this.planeView)
        : emptyDefaultHandler;

    const { leftClick: volumeLeftClick, ...volumeControls } =
      this.props.tracing.volume != null
        ? volumeController.getPlaneMouseControls(planeId)
        : emptyDefaultHandler;

    ensureNonConflictingHandlers(skeletonControls, volumeControls);

    return {
      ...baseControls,
      ...skeletonControls,
      ...volumeControls,
      leftClick: this.createToolDependentHandler(skeletonLeftClick, volumeLeftClick),
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
    const camera = this.planeView.getCameras()[OrthoViews.TDView];

    const rotation = THREE.Vector3.prototype.multiplyScalar.call(camera.rotation.clone(), -1);
    // reverse euler order
    rotation.order = rotation.order
      .split("")
      .reverse()
      .join("");

    nmVector.applyEuler(rotation);

    Store.dispatch(moveTDViewByVectorAction(nmVector.x, nmVector.y));
  }

  initTrackballControls(): void {
    Utils.waitForSelector("#inputcatcher_TDView").then(view => {
      const pos = voxelToNm(this.props.scale, getPosition(this.props.flycam));
      const tdCamera = this.planeView.getCameras()[OrthoViews.TDView];
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

  initKeyboard(): void {
    // avoid scrolling while pressing space
    document.addEventListener("keydown", (event: KeyboardEvent) => {
      if (
        (event.which === 32 || event.which === 18 || (event.which >= 37 && event.which <= 40)) &&
        Utils.isNoElementFocussed()
      ) {
        event.preventDefault();
      }
    });

    const getMoveValue = timeFactor => {
      const state = Store.getState();
      return (
        (state.userConfiguration.moveValue * timeFactor) /
        getBaseVoxel(state.dataset.dataSource.scale) /
        constants.FPS
      );
    };

    this.input.keyboard = new InputKeyboard({
      // Move
      left: timeFactor => this.moveX(-getMoveValue(timeFactor)),
      right: timeFactor => this.moveX(getMoveValue(timeFactor)),
      up: timeFactor => this.moveY(-getMoveValue(timeFactor)),
      down: timeFactor => this.moveY(getMoveValue(timeFactor)),
    });

    this.input.keyboardLoopDelayed = new InputKeyboard(
      {
        // KeyboardJS is sensitive to ordering (complex combos first)
        "shift + f": (timeFactor, first) => this.moveZ(getMoveValue(timeFactor) * 5, first),
        "shift + d": (timeFactor, first) => this.moveZ(-getMoveValue(timeFactor) * 5, first),

        "shift + i": () => this.changeBrushSizeIfBrushIsActive(-5),
        "shift + o": () => this.changeBrushSizeIfBrushIsActive(5),

        "shift + space": (timeFactor, first) => this.moveZ(-getMoveValue(timeFactor), first),
        "ctrl + space": (timeFactor, first) => this.moveZ(-getMoveValue(timeFactor), first),
        space: (timeFactor, first) => this.moveZ(getMoveValue(timeFactor), first),
        f: (timeFactor, first) => this.moveZ(getMoveValue(timeFactor), first),
        d: (timeFactor, first) => this.moveZ(-getMoveValue(timeFactor), first),

        // Zoom in/out
        i: () => this.zoom(1, false),
        o: () => this.zoom(-1, false),

        h: () => this.changeMoveValue(25),
        g: () => this.changeMoveValue(-25),
      },
      { delay: Store.getState().userConfiguration.keyboardDelay },
    );

    this.input.keyboardNoLoop = new InputKeyboardNoLoop(this.getKeyboardControls());

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        state => state.userConfiguration.keyboardDelay,
        keyboardDelay => {
          const { keyboardLoopDelayed } = this.input;
          if (keyboardLoopDelayed != null) {
            keyboardLoopDelayed.delay = keyboardDelay;
          }
        },
      ),
    );
  }

  getKeyboardControls(): Object {
    const baseControls = {
      "ctrl + i": event => {
        const segmentationLayer = Model.getSegmentationLayer();
        if (!segmentationLayer) {
          return;
        }
        const { mousePosition } = Store.getState().temporaryConfiguration;
        if (mousePosition) {
          const [x, y] = mousePosition;
          const globalMousePosition = calculateGlobalPos({ x, y });
          const { cube } = segmentationLayer;
          const mapping = event.altKey ? cube.getMapping() : null;
          const hoveredId = cube.getDataValue(
            globalMousePosition,
            mapping,
            getRequestLogZoomStep(Store.getState()),
          );
          Clipboard.copy(String(hoveredId)).then(() =>
            Toast.success(`Cell id ${hoveredId} copied to clipboard.`),
          );
        } else {
          Toast.warning("No cell under cursor.");
        }
      },
    };

    // TODO: Find a nicer way to express this, while satisfying flow
    const emptyDefaultHandler = { c: null, "1": null };
    const { c: skeletonCHandler, "1": skeletonOneHandler, ...skeletonControls } =
      this.props.tracing.skeleton != null
        ? skeletonController.getKeyboardControls()
        : emptyDefaultHandler;

    const { c: volumeCHandler, "1": volumeOneHandler, ...volumeControls } =
      this.props.tracing.volume != null
        ? volumeController.getKeyboardControls()
        : emptyDefaultHandler;

    ensureNonConflictingHandlers(skeletonControls, volumeControls);

    return {
      ...baseControls,
      ...skeletonControls,
      ...volumeControls,
      c: this.createToolDependentHandler(skeletonCHandler, volumeCHandler),
      "1": this.createToolDependentHandler(skeletonOneHandler, volumeOneHandler),
    };
  }

  init(): void {
    const { clippingDistance } = Store.getState().userConfiguration;
    SceneController.setClippingDistance(clippingDistance);
  }

  start(): void {
    this.bindToEvents();

    SceneController.startPlaneMode();
    this.planeView.start();

    this.initKeyboard();
    this.init();
    this.isStarted = true;

    // Workaround: defer mouse initialization to make sure DOM elements have
    // actually been rendered by React (InputCatchers Component)
    // DOM Elements get deleted when switching between ortho and arbitrary mode

    Utils.waitForSelector("#inputcatcher_TDView").then(() => {
      if (this.isStarted) {
        this.initTrackballControls();
        this.initMouse();
      }
    });
  }

  stop(): void {
    if (this.isStarted) {
      this.destroyInput();
      this.controls.destroy();
    }

    SceneController.stopPlaneMode();
    this.planeView.stop();
    this.stopListening();

    this.isStarted = false;
  }

  bindToEvents(): void {
    this.listenTo(this.planeView, "render", this.onPlaneViewRender);
  }

  onPlaneViewRender(): void {
    SceneController.update();
    this.props.onRender();
  }

  movePlane = (v: Vector3, increaseSpeedWithZoom: boolean = true) => {
    const { activeViewport } = Store.getState().viewModeData.plane;
    Store.dispatch(movePlaneFlycamOrthoAction(v, activeViewport, increaseSpeedWithZoom));
  };

  moveX = (x: number): void => {
    this.movePlane([x, 0, 0]);
  };

  moveY = (y: number): void => {
    this.movePlane([0, y, 0]);
  };

  moveZ = (z: number, oneSlide: boolean): void => {
    const { activeViewport } = Store.getState().viewModeData.plane;
    if (activeViewport === OrthoViews.TDView) {
      return;
    }

    if (oneSlide) {
      const logZoomStep = getRequestLogZoomStep(Store.getState());
      const w = Dimensions.getIndices(activeViewport)[2];
      const zStep = getResolutions(Store.getState().dataset)[logZoomStep][w];

      Store.dispatch(
        moveFlycamOrthoAction(
          Dimensions.transDim([0, 0, (z < 0 ? -1 : 1) * Math.max(1, zStep)], activeViewport),
          activeViewport,
        ),
      );
    } else {
      this.movePlane([0, 0, z], false);
    }
  };

  zoom(value: number, zoomToMouse: boolean): void {
    const { activeViewport } = Store.getState().viewModeData.plane;
    if (OrthoViewValuesWithoutTDView.includes(activeViewport)) {
      this.zoomPlanes(value, zoomToMouse);
    } else {
      this.zoomTDView(value, zoomToMouse);
    }
  }

  zoomPlanes(value: number, zoomToMouse: boolean): void {
    if (zoomToMouse) {
      this.zoomPos = this.getMousePosition();
    }

    Store.dispatch(zoomByDeltaAction(value));

    if (zoomToMouse) {
      this.finishZoom();
    }
  }

  zoomTDView(value: number, zoomToMouse: boolean = true): void {
    let zoomToPosition;
    if (zoomToMouse) {
      zoomToPosition = this.input.mouseControllers[OrthoViews.TDView].position;
    }
    const { width } = getInputCatcherRect(OrthoViews.TDView);
    Store.dispatch(zoomTDViewAction(value, zoomToPosition, width));
  }

  moveTDView(delta: Point2): void {
    const scale = getViewportScale(OrthoViews.TDView);
    Store.dispatch(moveTDViewXAction((delta.x / scale) * -1));
    Store.dispatch(moveTDViewYAction((delta.y / scale) * -1));
  }

  finishZoom = (): void => {
    // Move the plane so that the mouse is at the same position as
    // before the zoom
    const { activeViewport } = Store.getState().viewModeData.plane;
    if (this.isMouseOver() && activeViewport !== OrthoViews.TDView) {
      const mousePos = this.getMousePosition();
      const moveVector = [
        this.zoomPos[0] - mousePos[0],
        this.zoomPos[1] - mousePos[1],
        this.zoomPos[2] - mousePos[2],
      ];
      Store.dispatch(moveFlycamOrthoAction(moveVector, activeViewport));
    }
  };

  getMousePosition(): Vector3 {
    const { activeViewport } = Store.getState().viewModeData.plane;
    const pos = this.input.mouseControllers[activeViewport].position;
    if (pos != null) {
      return calculateGlobalPos(pos);
    }
    return [0, 0, 0];
  }

  isMouseOver(): boolean {
    return this.input.mouseControllers[Store.getState().viewModeData.plane.activeViewport]
      .isMouseOver;
  }

  changeMoveValue(delta: number): void {
    let moveValue = Store.getState().userConfiguration.moveValue + delta;
    moveValue = Math.min(constants.MAX_MOVE_VALUE, moveValue);
    moveValue = Math.max(constants.MIN_MOVE_VALUE, moveValue);

    Store.dispatch(updateUserSettingAction("moveValue", moveValue));

    const moveValueMessage = messages["tracing.changed_move_value"] + moveValue;
    Toast.success(moveValueMessage, { key: "CHANGED_MOVE_VALUE" });
  }

  changeBrushSizeIfBrushIsActive(changeValue: number) {
    const isBrushActive = Utils.maybe(getVolumeTool)(this.props.tracing.volume)
      .map(tool => tool === VolumeToolEnum.BRUSH)
      .getOrElse(false);
    if (isBrushActive) {
      const currentSize = Store.getState().temporaryConfiguration.brushSize;
      Store.dispatch(setBrushSizeAction(currentSize + changeValue));
    }
  }

  scrollPlanes(delta: number, type: ?ModifierKeys): void {
    switch (type) {
      case null: {
        this.moveZ(delta, true);
        break;
      }
      case "alt": {
        this.zoomPlanes(Utils.clamp(-1, delta, 1), true);
        break;
      }
      case "shift": {
        const isBrushActive = Utils.maybe(getVolumeTool)(this.props.tracing.volume)
          .map(tool => tool === VolumeToolEnum.BRUSH)
          .getOrElse(false);
        if (isBrushActive) {
          const currentSize = Store.getState().temporaryConfiguration.brushSize;
          // Different browsers send different deltas, this way the behavior is comparable
          Store.dispatch(setBrushSizeAction(currentSize + (delta > 0 ? 5 : -5)));
        } else if (this.props.tracing.skeleton) {
          // Different browsers send different deltas, this way the behavior is comparable
          api.tracing.setNodeRadius(delta > 0 ? 5 : -5);
        }
        break;
      }
      default: // ignore other cases
    }
  }

  unsubscribeStoreListeners() {
    this.storePropertyUnsubscribers.forEach(unsubscribe => unsubscribe());
    this.storePropertyUnsubscribers = [];
  }

  destroyInput() {
    for (const mouse of _.values(this.input.mouseControllers)) {
      mouse.destroy();
    }
    this.input.mouseControllers = {};
    Utils.__guard__(this.input.keyboard, x => x.destroy());
    Utils.__guard__(this.input.keyboardNoLoop, x1 => x1.destroy());
    Utils.__guard__(this.input.keyboardLoopDelayed, x2 => x2.destroy());
    this.unsubscribeStoreListeners();
  }

  updateControls = () => this.controls.update(true);

  createToolDependentHandler(skeletonHandler: ?Function, volumeHandler: ?Function): Function {
    return (...args) => {
      if (skeletonHandler && volumeHandler) {
        // Deal with both modes
        const tool = Utils.enforce(getVolumeTool)(this.props.tracing.volume);
        if (tool === VolumeToolEnum.MOVE) {
          skeletonHandler(...args);
        } else {
          volumeHandler(...args);
        }
        return;
      }
      if (skeletonHandler) skeletonHandler(...args);
      if (volumeHandler) volumeHandler(...args);
    };
  }

  render() {
    if (!this.controls) {
      return null;
    }

    return (
      <CameraController
        cameras={this.planeView.getCameras()}
        onCameraPositionChanged={this.updateControls}
      />
    );
  }
}

function threeCameraToCameraData(camera: THREE.OrthographicCamera): CameraData {
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

export function calculateGlobalPos(clickPos: Point2): Vector3 {
  let position;
  const state = Store.getState();
  const { activeViewport } = state.viewModeData.plane;
  const curGlobalPos = getPosition(state.flycam);
  const zoomFactor = getPlaneScalingFactor(state.flycam);
  const actualWidth = getInputCatcherRect(activeViewport).width;
  const viewportScale = actualWidth / constants.VIEWPORT_WIDTH;
  const planeRatio = getBaseVoxelFactors(state.dataset.dataSource.scale);

  const center = (constants.VIEWPORT_WIDTH * viewportScale) / 2;
  const diffX = ((center - clickPos.x) / viewportScale) * zoomFactor;
  const diffY = ((center - clickPos.y) / viewportScale) * zoomFactor;

  switch (activeViewport) {
    case OrthoViews.PLANE_XY:
      position = [
        curGlobalPos[0] - diffX * planeRatio[0],
        curGlobalPos[1] - diffY * planeRatio[1],
        curGlobalPos[2],
      ];
      break;
    case OrthoViews.PLANE_YZ:
      position = [
        curGlobalPos[0],
        curGlobalPos[1] - diffY * planeRatio[1],
        curGlobalPos[2] - diffX * planeRatio[2],
      ];
      break;
    case OrthoViews.PLANE_XZ:
      position = [
        curGlobalPos[0] - diffX * planeRatio[0],
        curGlobalPos[1],
        curGlobalPos[2] - diffY * planeRatio[2],
      ];
      break;
    default:
      console.error(
        `Trying to calculate the global position, but no viewport is active: ${activeViewport}`,
      );
      return [0, 0, 0];
  }

  return position;
}

export function mapStateToProps(state: OxalisState, ownProps: OwnProps): Props {
  return {
    flycam: state.flycam,
    scale: state.dataset.dataSource.scale,
    onRender: ownProps.onRender,
    tracing: state.tracing,
  };
}

export { PlaneController as PlaneControllerClass };
export default connect(mapStateToProps)(PlaneController);
