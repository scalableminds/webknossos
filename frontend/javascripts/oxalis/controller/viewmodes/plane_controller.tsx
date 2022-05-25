import { connect } from "react-redux";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'back... Remove this comment to see the full error message
import BackboneEvents from "backbone-events-standalone";
import * as React from "react";
import _ from "lodash";
import api from "oxalis/api/internal_api";
import dimensions from "oxalis/model/dimensions";
import {
  deleteActiveNodeAsUserAction,
  createTreeAction,
  createBranchPointAction,
  requestDeleteBranchPointAction,
  toggleAllTreesAction,
  toggleInactiveTreesAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { addUserBoundingBoxAction } from "oxalis/model/actions/annotation_actions";
import { InputKeyboard, InputKeyboardNoLoop, InputMouse } from "libs/input";
import { document } from "libs/window";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import { getPosition, getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { setViewportAction } from "oxalis/model/actions/view_mode_actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import Model from "oxalis/model";
import PlaneView from "oxalis/view/plane_view";
import type { OxalisState, Tracing } from "oxalis/store";
import Store from "oxalis/store";
import TDController from "oxalis/controller/td_controller";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import {
  createCellAction,
  copySegmentationLayerAction,
} from "oxalis/model/actions/volumetracing_actions";
import { cycleToolAction } from "oxalis/model/actions/ui_actions";
import {
  MoveTool,
  SkeletonTool,
  DrawTool,
  EraseTool,
  PickCellTool,
  FillCellTool,
  BoundingBoxTool,
  ProofreadTool,
} from "oxalis/controller/combinations/tool_controls";
import type {
  ShowContextMenuFunction,
  OrthoView,
  OrthoViewMap,
  AnnotationTool,
} from "oxalis/constants";
import constants, {
  OrthoViewValuesWithoutTDView,
  OrthoViews,
  AnnotationToolEnum,
} from "oxalis/constants";
import { calculateGlobalPos } from "oxalis/model/accessors/view_mode_accessor";
import getSceneController from "oxalis/controller/scene_controller_provider";
import * as SkeletonHandlers from "oxalis/controller/combinations/skeleton_handlers";
import * as VolumeHandlers from "oxalis/controller/combinations/volume_handlers";
import * as MoveHandlers from "oxalis/controller/combinations/move_handlers";
import { downloadScreenshot } from "oxalis/view/rendering_utils";

function ensureNonConflictingHandlers(
  skeletonControls: Record<string, any>,
  volumeControls: Record<string, any>,
): void {
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
  showContextMenuAt: ShowContextMenuFunction;
};

const cycleTools = () => {
  Store.dispatch(cycleToolAction());
};

type StateProps = {
  tracing: Tracing;
  activeTool: AnnotationTool;
};
type Props = StateProps & OwnProps;

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
      v: () => {
        Store.dispatch(copySegmentationLayerAction());
      },
      "shift + v": () => {
        Store.dispatch(copySegmentationLayerAction(true));
      },
    };
  }
}

class BoundingBoxKeybindings {
  static getKeyboardControls() {
    return {
      c: () => Store.dispatch(addUserBoundingBoxAction()),
    };
  }
}

const getMoveValue = (timeFactor: number) => {
  const state = Store.getState();
  return (
    (state.userConfiguration.moveValue * timeFactor) /
    getBaseVoxel(state.dataset.dataSource.scale) /
    constants.FPS
  );
};

function createDelayAwareMoveHandler(multiplier: number) {
  // The multiplier can be used for inverting the direction as well as for
  // speeding up the movement as it's done for shift+f, for example.
  const fn = (timeFactor: number, first: boolean) =>
    MoveHandlers.moveW(getMoveValue(timeFactor) * multiplier, first);

  fn.customAdditionalDelayFn = () => {
    // Depending on the float fraction of the current position, we want to
    // delay subsequent movements longer or shorter.
    // For example, when being at z=10.0 and keeping `f` pressed, the first
    // move action will simply set z=11.0. Afterwards, a user-defined keyboard
    // delay is awaited after which the continuous movement can begin (z=11.1,
    // z=11.2, ... z=11.9, z=12.0...).
    // However, doing the same logic with a starting z=10.99 would mean, that
    // the initial movement bumps z to 11.99 and after the delay has passed,
    // the slice will immediately switch to 12 (which is too fast).
    // To compensate this effect, this code here takes the current fraction (and
    // direction) into account to adapt the initial keyboard delay.
    const state = Store.getState();
    let direction = Math.sign(multiplier);
    const { activeViewport } = state.viewModeData.plane;

    if (activeViewport === OrthoViews.TDView) {
      // Nothing should happen then, anyway.
      return 0;
    }

    const thirdDim = dimensions.thirdDimensionForPlane(activeViewport);
    const voxelPerSecond =
      state.userConfiguration.moveValue / state.dataset.dataSource.scale[thirdDim];

    if (state.userConfiguration.dynamicSpaceDirection) {
      // Change direction of the value connected to space, based on the last direction
      direction *= state.flycam.spaceDirectionOrtho[thirdDim];
    }

    const fraction = getPosition(state.flycam)[thirdDim] % 1;
    const passedFraction = direction === 1 ? fraction : 1 - fraction;
    // Note that a passed fraction of 0 (e.g., z=11.0 and the direction
    // goes towards 12), means that no additional delay is needed.
    // The 1000 factor converts to ms.
    return (1000 / voxelPerSecond) * passedFraction;
  };

  return fn;
}

class PlaneController extends React.PureComponent<Props> {
  // See comment in Controller class on general controller architecture.
  //
  // Plane Controller: Responsible for Plane Modes
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'planeView' has no initializer and is not... Remove this comment to see the full error message
  planeView: PlaneView;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'input' has no initializer and is not def... Remove this comment to see the full error message
  input: {
    mouseControllers: OrthoViewMap<InputMouse>;
    keyboard?: InputKeyboard;
    keyboardNoLoop?: InputKeyboardNoLoop;
    keyboardLoopDelayed?: InputKeyboard;
  };

  storePropertyUnsubscribers: Array<(...args: Array<any>) => any>;
  isStarted: boolean = false;
  // Copied from backbone events (TODO: handle this better)
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'listenTo' has no initializer and is not ... Remove this comment to see the full error message
  listenTo: (...args: Array<any>) => any;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'stopListening' has no initializer and is... Remove this comment to see the full error message
  stopListening: (...args: Array<any>) => any;

  constructor(...args: any) {
    // @ts-expect-error ts-migrate(2556) FIXME: Expected 1-2 arguments, but got 0 or more.
    super(...args);

    _.extend(this, BackboneEvents);

    this.storePropertyUnsubscribers = [];
  }

  componentDidMount() {
    this.input = {
      // @ts-expect-error ts-migrate(2739) FIXME: Type '{}' is missing the following properties from... Remove this comment to see the full error message
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
    OrthoViewValuesWithoutTDView.forEach((id) => {
      const inputcatcherId = `inputcatcher_${OrthoViews[id]}`;
      Utils.waitForElementWithId(inputcatcherId).then((el) => {
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
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
  }

  getPlaneMouseControls(planeId: OrthoView): Record<string, any> {
    const moveControls = MoveTool.getMouseControls(
      planeId,
      this.planeView,
      this.props.showContextMenuAt,
    );
    const skeletonControls = SkeletonTool.getMouseControls(
      this.planeView,
      this.props.showContextMenuAt,
    );
    const drawControls = DrawTool.getPlaneMouseControls(
      planeId,
      this.planeView,
      this.props.showContextMenuAt,
    );
    const eraseControls = EraseTool.getPlaneMouseControls(
      planeId,
      this.planeView,
      this.props.showContextMenuAt,
    );
    const fillCellControls = FillCellTool.getPlaneMouseControls(planeId);
    const pickCellControls = PickCellTool.getPlaneMouseControls(planeId);
    const boundingBoxControls = BoundingBoxTool.getPlaneMouseControls(
      planeId,
      this.planeView,
      this.props.showContextMenuAt,
    );
    const proofreadControls = ProofreadTool.getPlaneMouseControls(planeId, this.planeView);

    const allControlKeys = _.union(
      Object.keys(moveControls),
      Object.keys(skeletonControls),
      Object.keys(drawControls),
      Object.keys(eraseControls),
      Object.keys(fillCellControls),
      Object.keys(pickCellControls),
      Object.keys(boundingBoxControls),
      Object.keys(proofreadControls),
    );

    const controls: Record<string, any> = {};

    for (const controlKey of allControlKeys) {
      controls[controlKey] = this.createToolDependentMouseHandler({
        [AnnotationToolEnum.MOVE]: moveControls[controlKey],
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        [AnnotationToolEnum.SKELETON]: skeletonControls[controlKey],
        [AnnotationToolEnum.BRUSH]: drawControls[controlKey],
        [AnnotationToolEnum.TRACE]: drawControls[controlKey],
        [AnnotationToolEnum.ERASE_BRUSH]: eraseControls[controlKey],
        [AnnotationToolEnum.ERASE_TRACE]: eraseControls[controlKey],
        [AnnotationToolEnum.PICK_CELL]: pickCellControls[controlKey],
        [AnnotationToolEnum.FILL_CELL]: fillCellControls[controlKey],
        [AnnotationToolEnum.BOUNDING_BOX]: boundingBoxControls[controlKey],
        [AnnotationToolEnum.PROOFREAD]: proofreadControls[controlKey],
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
    this.input.keyboard = new InputKeyboard({
      // Move
      left: (timeFactor) => MoveHandlers.moveU(-getMoveValue(timeFactor)),
      right: (timeFactor) => MoveHandlers.moveU(getMoveValue(timeFactor)),
      up: (timeFactor) => MoveHandlers.moveV(-getMoveValue(timeFactor)),
      down: (timeFactor) => MoveHandlers.moveV(getMoveValue(timeFactor)),
    });
    const notLoopedKeyboardControls = this.getNotLoopedKeyboardControls();
    const loopedKeyboardControls = this.getLoopedKeyboardControls();
    ensureNonConflictingHandlers(notLoopedKeyboardControls, loopedKeyboardControls);
    this.input.keyboardLoopDelayed = new InputKeyboard(
      {
        // KeyboardJS is sensitive to ordering (complex combos first)
        "shift + i": () => VolumeHandlers.changeBrushSizeIfBrushIsActiveBy(-1),
        "shift + o": () => VolumeHandlers.changeBrushSizeIfBrushIsActiveBy(1),
        "shift + f": createDelayAwareMoveHandler(5),
        "shift + d": createDelayAwareMoveHandler(-5),
        "shift + space": createDelayAwareMoveHandler(-1),
        "ctrl + space": createDelayAwareMoveHandler(-1),
        space: createDelayAwareMoveHandler(1),
        f: createDelayAwareMoveHandler(1),
        d: createDelayAwareMoveHandler(-1),
        // Zoom in/out
        i: () => MoveHandlers.zoom(1, false),
        o: () => MoveHandlers.zoom(-1, false),
        h: () => this.changeMoveValue(25),
        g: () => this.changeMoveValue(-25),
        ...loopedKeyboardControls,
      },
      {
        delay: Store.getState().userConfiguration.keyboardDelay,
      },
    );
    this.input.keyboardNoLoop = new InputKeyboardNoLoop(notLoopedKeyboardControls);
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (state) => state.userConfiguration.keyboardDelay,
        (keyboardDelay) => {
          const { keyboardLoopDelayed } = this.input;

          if (keyboardLoopDelayed != null) {
            keyboardLoopDelayed.delay = keyboardDelay;
          }
        },
      ),
    );
  }

  getNotLoopedKeyboardControls(): Record<string, any> {
    const baseControls = {
      "ctrl + i": (event: React.KeyboardEvent) => {
        const segmentationLayer = Model.getVisibleSegmentationLayer();

        if (!segmentationLayer) {
          return;
        }

        const { mousePosition } = Store.getState().temporaryConfiguration;

        if (mousePosition) {
          const [x, y] = mousePosition;
          const globalMousePosition = calculateGlobalPos(Store.getState(), {
            x,
            y,
          });
          const { cube } = segmentationLayer;
          const mapping = event.altKey ? cube.getMapping() : null;
          const hoveredId = cube.getDataValue(
            globalMousePosition,
            mapping,
            getRequestLogZoomStep(Store.getState()),
          );
          navigator.clipboard
            .writeText(String(hoveredId))
            .then(() => Toast.success(`Segment id ${hoveredId} copied to clipboard.`));
        } else {
          Toast.warning("No segment under cursor.");
        }
      },
      q: downloadScreenshot,
      w: cycleTools,
    };
    // TODO: Find a nicer way to express this, while satisfying flow
    const emptyDefaultHandler = {
      c: null,
    };
    const { c: skeletonCHandler, ...skeletonControls } =
      this.props.tracing.skeleton != null
        ? SkeletonKeybindings.getKeyboardControls()
        : emptyDefaultHandler;
    const { c: volumeCHandler, ...volumeControls } =
      this.props.tracing.volumes.length > 0
        ? VolumeKeybindings.getKeyboardControls()
        : emptyDefaultHandler;
    const { c: boundingBoxCHandler } = BoundingBoxKeybindings.getKeyboardControls();
    ensureNonConflictingHandlers(skeletonControls, volumeControls);

    return {
      ...baseControls,
      ...skeletonControls,
      ...volumeControls,
      c: this.createToolDependentKeyboardHandler(
        skeletonCHandler,
        volumeCHandler,
        boundingBoxCHandler,
      ),
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
    this.storePropertyUnsubscribers.forEach((unsubscribe) => unsubscribe());
    this.storePropertyUnsubscribers = [];
  }

  destroyInput() {
    for (const mouse of _.values(this.input.mouseControllers)) {
      mouse.destroy();
    }

    // @ts-expect-error ts-migrate(2739) FIXME: Type '{}' is missing the following properties from... Remove this comment to see the full error message
    this.input.mouseControllers = {};

    this.input.keyboard?.destroy();
    this.input.keyboardNoLoop?.destroy();
    this.input.keyboardLoopDelayed?.destroy();

    this.unsubscribeStoreListeners();
  }

  createToolDependentKeyboardHandler(
    skeletonHandler: ((...args: Array<any>) => any) | null | undefined,
    volumeHandler: ((...args: Array<any>) => any) | null | undefined,
    boundingBoxHandler: ((...args: Array<any>) => any) | null | undefined,
    viewHandler?: ((...args: Array<any>) => any) | null | undefined,
  ): (...args: Array<any>) => any {
    return (...args) => {
      const tool = this.props.activeTool;

      switch (tool) {
        case AnnotationToolEnum.MOVE: {
          if (viewHandler != null) {
            viewHandler(...args);
          } else if (skeletonHandler != null) {
            skeletonHandler(...args);
          }

          return;
        }

        case AnnotationToolEnum.SKELETON: {
          if (skeletonHandler != null) {
            skeletonHandler(...args);
          } else if (viewHandler != null) {
            viewHandler(...args);
          }

          return;
        }

        case AnnotationToolEnum.BOUNDING_BOX: {
          if (boundingBoxHandler != null) {
            boundingBoxHandler(...args);
          } else if (viewHandler != null) {
            viewHandler(...args);
          }

          return;
        }

        default: {
          if (volumeHandler != null) {
            volumeHandler(...args);
          } else if (viewHandler != null) {
            viewHandler(...args);
          }
        }
      }
    };
  }

  createToolDependentMouseHandler(
    toolToHandlerMap: Record<AnnotationTool, (...args: Array<any>) => any>,
  ): (...args: Array<any>) => any {
    return (...args) => {
      const tool = this.props.activeTool;
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
        showContextMenuAt={this.props.showContextMenuAt}
      />
    );
  }
}

export function mapStateToProps(state: OxalisState): StateProps {
  return {
    tracing: state.tracing,
    activeTool: state.uiInformation.activeTool,
  };
}
export { PlaneController as PlaneControllerClass };
const connector = connect(mapStateToProps);
export default connector(PlaneController);
