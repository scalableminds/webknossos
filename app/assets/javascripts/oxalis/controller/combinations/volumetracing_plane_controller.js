/**
 * volumetracing_plane_controller.js
 * @flow
 */

import _ from "lodash";
import { connect } from "react-redux";
import Store from "oxalis/store";
import Utils from "libs/utils";
import { OrthoViews, VolumeToolEnum, ContourModeEnum } from "oxalis/constants";
import {
  PlaneControllerClass,
  mapStateToProps,
} from "oxalis/controller/viewmodes/plane_controller";
import SceneController from "oxalis/controller/scene_controller";
import Model from "oxalis/model";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import { setPositionAction } from "oxalis/model/actions/flycam_actions";
import {
  createCellAction,
  setToolAction,
  startEditingAction,
  addToLayerAction,
  finishEditingAction,
  setBrushPositionAction,
  hideBrushAction,
  setBrushSizeAction,
  setContourTracingMode,
  cycleToolAction,
  copySegmentationLayerAction,
  setActiveCellAction,
} from "oxalis/model/actions/volumetracing_actions";
import {
  getActiveCellId,
  getVolumeTool,
  getContourTracingMode,
} from "oxalis/model/accessors/volumetracing_accessor";
import { InputKeyboardNoLoop } from "libs/input";

import type { OrthoViewType, Point2 } from "oxalis/constants";
import type { ModifierKeys } from "libs/input";

class VolumeTracingPlaneController extends PlaneControllerClass {
  // See comment in Controller class on general controller architecture.
  //
  // Volume Tracing Plane Controller:
  // Extends Plane controller to add controls that are specific to Volume
  // Tracing.

  prevActiveCellId: number;
  keyboardNoLoop: InputKeyboardNoLoop;

  componentDidMount() {
    super.componentDidMount();

    let lastActiveCellId = getActiveCellId(Store.getState().tracing).get();
    Store.subscribe(() => {
      getActiveCellId(Store.getState().tracing).map(cellId => {
        if (lastActiveCellId !== cellId) {
          SceneController.renderVolumeIsosurface(cellId);
          lastActiveCellId = cellId;
        }
      });
    });

    // If a new mapping is activated the 3D cell has to be updated, although the activeCellId did not change
    this.listenTo(Model.getSegmentationBinary().cube, "newMapping", () =>
      SceneController.renderVolumeIsosurface(lastActiveCellId),
    );

    this.keyboardNoLoop = new InputKeyboardNoLoop({
      w: () => {
        Store.dispatch(cycleToolAction());
      },
      "1": () => {
        Store.dispatch(cycleToolAction());
      },
      v: () => {
        Store.dispatch(copySegmentationLayerAction());
      },
      "shift + v": () => {
        Store.dispatch(copySegmentationLayerAction(true));
      },
    });
  }

  componentWillUnmount() {
    this.keyboardNoLoop.destroy();
    super.componentWillUnmount();
  }

  simulateTracing = async (): Promise<void> => {
    Store.dispatch(setToolAction(VolumeToolEnum.TRACE));

    const controls = this.getPlaneMouseControls(OrthoViews.PLANE_XY);
    let pos = (x, y) => ({ x, y });

    controls.leftMouseDown(pos(100, 100), OrthoViews.PLANE_XY, {});
    await Utils.sleep(100);
    controls.leftDownMove(null, pos(200, 100));
    await Utils.sleep(100);
    controls.leftDownMove(null, pos(200, 200));
    await Utils.sleep(100);
    controls.leftDownMove(null, pos(100, 200));
    await Utils.sleep(100);
    controls.leftDownMove(null, pos(100, 100));
    controls.leftMouseUp();
    await Utils.sleep(100);
    pos = _.clone(getPosition(Store.getState().flycam));
    pos[2]++;
    Store.dispatch(setPositionAction(pos));
    await Utils.sleep(100);
    await this.simulateTracing();
  };

  getPlaneMouseControls(planeId: OrthoViewType): Object {
    return _.extend(super.getPlaneMouseControls(planeId), {
      leftDownMove: (delta: Point2, pos: Point2) => {
        const { tracing } = Store.getState();
        const tool = getVolumeTool(tracing).get();
        const contourTracingMode = getContourTracingMode(tracing).get();

        if (tool === VolumeToolEnum.MOVE) {
          const viewportScale = Store.getState().userConfiguration.scale;
          this.movePlane([delta.x * -1 / viewportScale, delta.y * -1 / viewportScale, 0]);
        }

        if (
          (tool === VolumeToolEnum.TRACE || tool === VolumeToolEnum.BRUSH) &&
          contourTracingMode === ContourModeEnum.ADD_TO_VOLUME
        ) {
          Store.dispatch(addToLayerAction(this.calculateGlobalPos(pos)));
        }
      },

      leftMouseDown: (pos: Point2, plane: OrthoViewType, event: MouseEvent) => {
        const tool = getVolumeTool(Store.getState().tracing).get();

        if (!event.shiftKey && (tool === VolumeToolEnum.TRACE || tool === VolumeToolEnum.BRUSH)) {
          Store.dispatch(setContourTracingMode(ContourModeEnum.ADD_TO_VOLUME));
          Store.dispatch(startEditingAction(this.calculateGlobalPos(pos), plane));
        }
      },

      leftMouseUp: () => {
        const tool = getVolumeTool(Store.getState().tracing).get();

        Store.dispatch(setContourTracingMode(ContourModeEnum.IDLE));

        if (tool === VolumeToolEnum.TRACE || tool === VolumeToolEnum.BRUSH) {
          Store.dispatch(finishEditingAction());
        }
      },

      rightDownMove: (delta: Point2, pos: Point2) => {
        const { tracing } = Store.getState();
        const tool = getVolumeTool(tracing).get();
        const contourTracingMode = getContourTracingMode(tracing).get();

        if (
          (tool === VolumeToolEnum.TRACE || tool === VolumeToolEnum.BRUSH) &&
          contourTracingMode === ContourModeEnum.DELETE_FROM_VOLUME
        ) {
          Store.dispatch(addToLayerAction(this.calculateGlobalPos(pos)));
        }
      },

      rightMouseDown: (pos: Point2, plane: OrthoViewType, event: MouseEvent) => {
        const tool = getVolumeTool(Store.getState().tracing).get();

        if (!event.shiftKey && (tool === VolumeToolEnum.TRACE || tool === VolumeToolEnum.BRUSH)) {
          getActiveCellId(Store.getState().tracing).map(activeCellId => {
            this.prevActiveCellId = activeCellId;
          });

          Store.dispatch(setActiveCellAction(0));
          Store.dispatch(setContourTracingMode(ContourModeEnum.DELETE_FROM_VOLUME));
          Store.dispatch(startEditingAction(this.calculateGlobalPos(pos), plane));
        }
      },

      rightMouseUp: () => {
        const tool = getVolumeTool(Store.getState().tracing).get();

        Store.dispatch(setContourTracingMode(ContourModeEnum.IDLE));

        if (tool === VolumeToolEnum.TRACE || tool === VolumeToolEnum.BRUSH) {
          Store.dispatch(finishEditingAction());
          Store.dispatch(setActiveCellAction(this.prevActiveCellId));
          Store.dispatch(setContourTracingMode(ContourModeEnum.IDLE));
        }
      },

      leftClick: (pos: Point2, plane: OrthoViewType, event: MouseEvent) => {
        if (event.shiftKey) {
          const cellId = Model.getSegmentationBinary().cube.getDataValue(
            this.calculateGlobalPos(pos),
          );
          this.handleCellSelection(cellId);
        }
      },

      mouseMove: (delta: Point2, position: Point2) => {
        const tool = getVolumeTool(Store.getState().tracing).get();

        if (tool === VolumeToolEnum.BRUSH) {
          Store.dispatch(setBrushPositionAction([position.x, position.y]));
        }
      },

      out: () => {
        Store.dispatch(hideBrushAction());
      },

      scroll: (delta: number, type: ?ModifierKeys) => {
        const tool = getVolumeTool(Store.getState().tracing).get();
        if (tool === VolumeToolEnum.BRUSH && type === "shift") {
          const currentSize = Store.getState().temporaryConfiguration.brushSize;
          // Different browsers send different deltas, this way the behavior is comparable
          Store.dispatch(setBrushSizeAction(currentSize + (delta > 0 ? 5 : -5)));
        } else {
          this.scrollPlanes(delta, type);
        }
      },
    });
  }

  getKeyboardControls(): Object {
    return _.extend(super.getKeyboardControls(), {
      c: () => Store.dispatch(createCellAction()),
    });
  }

  handleCellSelection(cellId: number) {
    if (cellId > 0) {
      Store.dispatch(setActiveCellAction(cellId));
    }
  }
}

export default connect(mapStateToProps)(VolumeTracingPlaneController);
