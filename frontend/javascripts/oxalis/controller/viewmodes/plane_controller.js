/**
 * plane_controller.js
 * @flow
 */

import { connect } from "react-redux";
import BackboneEvents from "backbone-events-standalone";
import Clipboard from "clipboard-js";
import * as React from "react";
import _ from "lodash";

import { InputKeyboard, InputKeyboardNoLoop, InputMouse, type ModifierKeys } from "libs/input";
import { changeActiveIsosurfaceCellAction } from "oxalis/model/actions/segmentation_actions";
import { document } from "libs/window";
import { getBaseVoxel, getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import { getViewportScale, getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import {
  getPosition,
  getRequestLogZoomStep,
  getPlaneScalingFactor,
} from "oxalis/model/accessors/flycam_accessor";
import { getResolutions } from "oxalis/model/accessors/dataset_accessor";
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
import { setViewportAction, zoomTDViewAction } from "oxalis/model/actions/view_mode_actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import Dimensions from "oxalis/model/dimensions";
import Model from "oxalis/model";
import PlaneView from "oxalis/view/plane_view";
import Store, { type OxalisState, type Tracing } from "oxalis/store";
import TDController from "oxalis/controller/td_controller";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import api from "oxalis/api/internal_api";
import constants, {
  type OrthoView,
  type OrthoViewMap,
  OrthoViewValuesWithoutTDView,
  OrthoViews,
  type Point2,
  type Vector3,
  VolumeToolEnum,
} from "oxalis/constants";
import getSceneController from "oxalis/controller/scene_controller_provider";
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

const isosurfaceLeftClick = (pos: Point2, plane: OrthoView, event: MouseEvent) => {
  if (!event.shiftKey) {
    return;
  }
  const segmentation = Model.getSegmentationLayer();
  if (!segmentation) {
    return;
  }
  const position = calculateGlobalPos(pos);
  const cellId = segmentation.cube.getMappedDataValue(
    position,
    getRequestLogZoomStep(Store.getState()),
  );
  if (cellId > 0) {
    Store.dispatch(changeActiveIsosurfaceCellAction(cellId, position));
  }
};

type OwnProps = {|
  onRender: () => void,
|};
type StateProps = {|
  tracing: Tracing,
|};
type Props = {| ...OwnProps, ...StateProps |};

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
  zoomPos: Vector3;
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

    this.planeView = new PlaneView();
    this.forceUpdate();

    Store.dispatch(setViewportAction(OrthoViews.PLANE_XY));
    this.start();
  }

  componentWillUnmount() {
    this.stop();
  }

  initMouse(): void {
    // Workaround: We are only waiting for tdview since this
    // introduces the necessary delay to attach the events to the
    // newest input catchers. We should refactor the
    // InputMouse handling so that this is not necessary anymore.
    // See: https://github.com/scalableminds/webknossos/issues/3475
    const tdSelector = `#inputcatcher_${OrthoViews.TDView}`;
    Utils.waitForSelector(tdSelector).then(() => {
      OrthoViewValuesWithoutTDView.forEach(id => {
        const inputcatcherSelector = `#inputcatcher_${OrthoViews[id]}`;
        Utils.waitForSelector(inputcatcherSelector).then(el => {
          if (!document.body.contains(el)) {
            console.error("el is not attached anymore");
          }
          this.input.mouseControllers[id] = new InputMouse(
            inputcatcherSelector,
            this.getPlaneMouseControls(id),
            id,
          );
        });
      });
    });
  }

  getPlaneMouseControls(planeId: OrthoView): Object {
    const baseControls = {
      leftDownMove: (delta: Point2) => this.movePlane([-delta.x, -delta.y, 0]),
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
    const { leftClick: maybeSkeletonLeftClick, ...skeletonControls } =
      this.props.tracing.skeleton != null
        ? skeletonController.getPlaneMouseControls(this.planeView)
        : emptyDefaultHandler;

    const { leftClick: maybeVolumeLeftClick, ...volumeControls } =
      this.props.tracing.volume != null
        ? volumeController.getPlaneMouseControls(planeId)
        : emptyDefaultHandler;

    ensureNonConflictingHandlers(skeletonControls, volumeControls);

    return {
      ...baseControls,
      ...skeletonControls,
      ...volumeControls,
      leftClick: this.createToolDependentHandler(
        maybeSkeletonLeftClick,
        maybeVolumeLeftClick,
        // The isosurfaceLeftClick handler should only be used in view mode.
        isosurfaceLeftClick,
      ),
    };
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
    getSceneController().setClippingDistance(clippingDistance);
  }

  start(): void {
    this.bindToEvents();

    getSceneController().startPlaneMode();
    this.planeView.start();

    this.initKeyboard();
    this.initMouse();
    this.init();
    this.isStarted = true;
  }

  stop(): void {
    if (this.isStarted) {
      this.destroyInput();
    }

    getSceneController().stopPlaneMode();
    this.planeView.stop();
    this.stopListening();

    this.isStarted = false;
  }

  bindToEvents(): void {
    this.listenTo(this.planeView, "render", this.onPlaneViewRender);
  }

  onPlaneViewRender(): void {
    getSceneController().update();
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
      this.zoomTDView(value);
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

  zoomTDView(value: number): void {
    const zoomToPosition = null;
    const { width, height } = getInputCatcherRect(Store.getState(), OrthoViews.TDView);
    Store.dispatch(zoomTDViewAction(value, zoomToPosition, width, height));
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

  createToolDependentHandler(
    skeletonHandler: ?Function,
    volumeHandler: ?Function,
    viewHandler?: ?Function,
  ): Function {
    return (...args) => {
      if (skeletonHandler && volumeHandler) {
        // Deal with both modes
        const tool = Utils.enforce(getVolumeTool)(this.props.tracing.volume);
        if (tool === VolumeToolEnum.MOVE) {
          skeletonHandler(...args);
        } else {
          volumeHandler(...args);
        }
      } else if (skeletonHandler) {
        skeletonHandler(...args);
      } else if (volumeHandler) {
        volumeHandler(...args);
      } else if (viewHandler != null) {
        // At this point, neither skeletonHandler nor volumeHandler is defined.
        // Instead, use the viewHandler, if it's defined.
        viewHandler(...args);
      }
    };
  }

  render() {
    if (!this.planeView) {
      return null;
    }

    return (
      <TDController
        cameras={this.planeView.getCameras()}
        tracing={this.props.tracing}
        planeView={this.planeView}
      />
    );
  }
}

export function calculateGlobalPos(clickPos: Point2): Vector3 {
  let position;
  const state = Store.getState();
  const { activeViewport } = state.viewModeData.plane;
  const curGlobalPos = getPosition(state.flycam);
  const zoomFactors = getPlaneScalingFactor(state, state.flycam, activeViewport);
  const viewportScale = getViewportScale(state, activeViewport);
  const planeRatio = getBaseVoxelFactors(state.dataset.dataSource.scale);

  const center = [0, 1].map(dim => (constants.VIEWPORT_WIDTH * viewportScale[dim]) / 2);
  const diffX = ((center[0] - clickPos.x) / viewportScale[0]) * zoomFactors[0];
  const diffY = ((center[1] - clickPos.y) / viewportScale[1]) * zoomFactors[1];

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

export function mapStateToProps(state: OxalisState): StateProps {
  return {
    tracing: state.tracing,
  };
}

export { PlaneController as PlaneControllerClass };
export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(PlaneController);
