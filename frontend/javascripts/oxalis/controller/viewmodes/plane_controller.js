/**
 * plane_controller.js
 * @flow
 */

import { connect } from "react-redux";
import BackboneEvents from "backbone-events-standalone";
import Clipboard from "clipboard-js";
import * as React from "react";
import _ from "lodash";
import api from "oxalis/api/internal_api";
import {
  deleteActiveNodeAsUserAction,
  createTreeAction,
  createBranchPointAction,
  requestDeleteBranchPointAction,
  toggleAllTreesAction,
  toggleInactiveTreesAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { InputKeyboard, InputKeyboardNoLoop, InputMouse } from "libs/input";
import { document } from "libs/window";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { setViewportAction } from "oxalis/model/actions/view_mode_actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import Model from "oxalis/model";
import PlaneView from "oxalis/view/plane_view";
import Store, { type OxalisState, type Tracing } from "oxalis/store";
import TDController from "oxalis/controller/td_controller";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import {
  createCellAction,
  cycleToolAction,
  copySegmentationLayerAction,
} from "oxalis/model/actions/volumetracing_actions";
import {
  MoveTool,
  SkeletonTool,
  DrawTool,
  PickCellTool,
  FillCellTool,
} from "oxalis/controller/combinations/tool_controls";
import constants, {
  type ShowContextMenuFunction,
  type OrthoView,
  type OrthoViewMap,
  OrthoViewValuesWithoutTDView,
  OrthoViews,
  type AnnotationTool,
  AnnotationToolEnum,
} from "oxalis/constants";
import { calculateGlobalPos } from "oxalis/model/accessors/view_mode_accessor";
import getSceneController from "oxalis/controller/scene_controller_provider";
import * as SkeletonHandlers from "oxalis/controller/combinations/skeleton_handlers";
import * as VolumeHandlers from "oxalis/controller/combinations/volume_handlers";
import * as MoveHandlers from "oxalis/controller/combinations/move_handlers";
import { downloadScreenshot } from "oxalis/view/rendering_utils";

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

type OwnProps = {| showNodeContextMenuAt: ShowContextMenuFunction |};

type StateProps = {|
  tracing: Tracing,
|};

type Props = {|
  ...StateProps,
  ...OwnProps,
|};

class SkeletonKeybindings {
  static getKeyboardControls() {
    return {
      "1": () => Store.dispatch(toggleAllTreesAction()),
      "2": () => Store.dispatch(toggleInactiveTreesAction()),

      // Delete active node
      delete: () => Store.dispatch(deleteActiveNodeAsUserAction(Store.getState())),
      c: () => Store.dispatch(createTreeAction()),

      e: () => SkeletonHandlers.moveAlongDirection(),
      r: () => SkeletonHandlers.moveAlongDirection(true),

      // Branches
      b: () => Store.dispatch(createBranchPointAction()),
      j: () => Store.dispatch(requestDeleteBranchPointAction()),

      s: () => {
        api.tracing.centerNode();
        api.tracing.centerTDView();
      },

      // navigate nodes
      "ctrl + ,": () => SkeletonHandlers.toPrecedingNode(),
      "ctrl + .": () => SkeletonHandlers.toSubsequentNode(),
    };
  }

  static getLoopedKeyboardControls() {
    return {
      "ctrl + left": () => SkeletonHandlers.moveNode(-1, 0),
      "ctrl + right": () => SkeletonHandlers.moveNode(1, 0),
      "ctrl + up": () => SkeletonHandlers.moveNode(0, -1),
      "ctrl + down": () => SkeletonHandlers.moveNode(0, 1),
    };
  }
}

class VolumeKeybindings {
  static getKeyboardControls() {
    return {
      c: () => Store.dispatch(createCellAction()),
      "1": () => {
        Store.dispatch(cycleToolAction());
      },
      v: () => {
        Store.dispatch(copySegmentationLayerAction());
      },
      "shift + v": () => {
        Store.dispatch(copySegmentationLayerAction(true));
      },
    };
  }
}

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
    // Workaround: We are only waiting for tdview since this introduces
    // the necessary delay to attach the events to the newest input
    // catchers (only necessary for HammerJS). We should refactor the
    // InputMouse handling so that this is not necessary anymore.
    // See: https://github.com/scalableminds/webknossos/issues/3475
    const tdId = `inputcatcher_${OrthoViews.TDView}`;
    Utils.waitForElementWithId(tdId).then(() => {
      OrthoViewValuesWithoutTDView.forEach(id => {
        const inputcatcherId = `inputcatcher_${OrthoViews[id]}`;
        Utils.waitForElementWithId(inputcatcherId).then(el => {
          if (!document.body.contains(el)) {
            console.error("el is not attached anymore");
          }
          this.input.mouseControllers[id] = new InputMouse(
            inputcatcherId,
            this.getPlaneMouseControls(id),
            id,
            true,
          );
        });
      });
    });
  }

  getPlaneMouseControls(planeId: OrthoView): Object {
    const moveControls = MoveTool.getMouseControls(
      planeId,
      this.planeView,
      this.props.showNodeContextMenuAt,
    );

    const skeletonControls = SkeletonTool.getMouseControls(
      this.planeView,
      this.props.showNodeContextMenuAt,
    );

    const drawControls = DrawTool.getPlaneMouseControls(planeId);
    const fillCellControls = FillCellTool.getPlaneMouseControls(planeId);
    const pickCellControls = PickCellTool.getPlaneMouseControls(planeId);

    const allControlKeys = _.union(
      Object.keys(moveControls),
      Object.keys(skeletonControls),
      Object.keys(drawControls),
      Object.keys(fillCellControls),
      Object.keys(pickCellControls),
    );
    const controls = {};

    for (const controlKey of allControlKeys) {
      controls[controlKey] = this.createToolDependentMouseHandler({
        [AnnotationToolEnum.MOVE]: moveControls[controlKey],
        [AnnotationToolEnum.SKELETON]: skeletonControls[controlKey],
        [AnnotationToolEnum.BRUSH]: drawControls[controlKey],
        [AnnotationToolEnum.TRACE]: drawControls[controlKey],
        [AnnotationToolEnum.PICK_CELL]: pickCellControls[controlKey],
        [AnnotationToolEnum.FILL_CELL]: fillCellControls[controlKey],
      });
    }

    return controls;
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
      left: timeFactor => MoveHandlers.moveX(-getMoveValue(timeFactor)),
      right: timeFactor => MoveHandlers.moveX(getMoveValue(timeFactor)),
      up: timeFactor => MoveHandlers.moveY(-getMoveValue(timeFactor)),
      down: timeFactor => MoveHandlers.moveY(getMoveValue(timeFactor)),
    });

    const notLoopedKeyboardControls = this.getNotLoopedKeyboardControls();
    const loopedKeyboardControls = this.getLoopedKeyboardControls();
    ensureNonConflictingHandlers(notLoopedKeyboardControls, loopedKeyboardControls);

    this.input.keyboardLoopDelayed = new InputKeyboard(
      {
        // KeyboardJS is sensitive to ordering (complex combos first)
        "shift + f": (timeFactor, first) => MoveHandlers.moveZ(getMoveValue(timeFactor) * 5, first),
        "shift + d": (timeFactor, first) =>
          MoveHandlers.moveZ(-getMoveValue(timeFactor) * 5, first),

        "shift + i": () => VolumeHandlers.changeBrushSizeIfBrushIsActiveBy(-1),
        "shift + o": () => VolumeHandlers.changeBrushSizeIfBrushIsActiveBy(1),

        "shift + space": (timeFactor, first) =>
          MoveHandlers.moveZ(-getMoveValue(timeFactor), first),
        "ctrl + space": (timeFactor, first) => MoveHandlers.moveZ(-getMoveValue(timeFactor), first),
        space: (timeFactor, first) => MoveHandlers.moveZ(getMoveValue(timeFactor), first),
        f: (timeFactor, first) => MoveHandlers.moveZ(getMoveValue(timeFactor), first),
        d: (timeFactor, first) => MoveHandlers.moveZ(-getMoveValue(timeFactor), first),

        // Zoom in/out
        i: () => MoveHandlers.zoom(1, false),
        o: () => MoveHandlers.zoom(-1, false),

        h: () => this.changeMoveValue(25),
        g: () => this.changeMoveValue(-25),

        w: () => {
          Store.dispatch(cycleToolAction());
        },
        ...loopedKeyboardControls,
      },
      { delay: Store.getState().userConfiguration.keyboardDelay },
    );

    this.input.keyboardNoLoop = new InputKeyboardNoLoop(notLoopedKeyboardControls);

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

  getNotLoopedKeyboardControls(): Object {
    const baseControls = {
      "ctrl + i": event => {
        const segmentationLayer = Model.getSegmentationLayer();
        if (!segmentationLayer) {
          return;
        }
        const { mousePosition } = Store.getState().temporaryConfiguration;
        if (mousePosition) {
          const [x, y] = mousePosition;
          const globalMousePosition = calculateGlobalPos(Store.getState(), { x, y });
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
      q: downloadScreenshot,
    };

    // TODO: Find a nicer way to express this, while satisfying flow
    const emptyDefaultHandler = { c: null, "1": null };
    const { c: skeletonCHandler, "1": skeletonOneHandler, ...skeletonControls } =
      this.props.tracing.skeleton != null
        ? SkeletonKeybindings.getKeyboardControls()
        : emptyDefaultHandler;

    const { c: volumeCHandler, "1": volumeOneHandler, ...volumeControls } =
      this.props.tracing.volume != null
        ? VolumeKeybindings.getKeyboardControls()
        : emptyDefaultHandler;

    ensureNonConflictingHandlers(skeletonControls, volumeControls);

    return {
      ...baseControls,
      ...skeletonControls,
      // $FlowIssue[exponential-spread] See https://github.com/facebook/flow/issues/8299
      ...volumeControls,
      c: this.createToolDependentKeyboardHandler(skeletonCHandler, volumeCHandler),
      "1": this.createToolDependentKeyboardHandler(skeletonOneHandler, volumeOneHandler),
    };
  }

  getLoopedKeyboardControls() {
    // Note that this code needs to be adapted in case the VolumeHandlers also starts to expose
    // looped keyboard controls. For the hybrid case, these two controls would need t be combined then.
    return this.props.tracing.skeleton != null
      ? SkeletonKeybindings.getLoopedKeyboardControls()
      : {};
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
  }

  changeMoveValue(delta: number): void {
    const moveValue = Store.getState().userConfiguration.moveValue + delta;
    Store.dispatch(updateUserSettingAction("moveValue", moveValue));
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

  createToolDependentKeyboardHandler(
    skeletonHandler: ?Function,
    volumeHandler: ?Function,
    viewHandler?: ?Function,
  ): Function {
    return (...args) => {
      const tool = this.props.tracing.activeTool;
      if (tool === AnnotationToolEnum.MOVE) {
        if (viewHandler != null) {
          viewHandler(...args);
        } else if (skeletonHandler != null) {
          skeletonHandler(...args);
        }
      } else if (tool === AnnotationToolEnum.SKELETON) {
        if (skeletonHandler != null) {
          skeletonHandler(...args);
        } else if (viewHandler != null) {
          viewHandler(...args);
        }
      } else {
        // eslint-disable-next-line no-lonely-if
        if (volumeHandler != null) {
          volumeHandler(...args);
        } else if (viewHandler != null) {
          viewHandler(...args);
        }
      }
    };
  }

  createToolDependentMouseHandler(toolToHandlerMap: { [key: AnnotationTool]: Function }): Function {
    return (...args) => {
      const tool = this.props.tracing.activeTool;
      const handler = toolToHandlerMap[tool];
      const fallbackHandler = toolToHandlerMap[AnnotationToolEnum.MOVE];
      if (handler != null) {
        handler(...args);
      } else if (fallbackHandler != null) {
        fallbackHandler(...args);
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

export function mapStateToProps(state: OxalisState): StateProps {
  return {
    tracing: state.tracing,
  };
}

export { PlaneController as PlaneControllerClass };
export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(PlaneController);
