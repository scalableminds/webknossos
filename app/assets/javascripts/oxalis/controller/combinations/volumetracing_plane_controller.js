/**
 * volumetracing_plane_controller.js
 * @flow
 */

import _ from "lodash";
import Store from "oxalis/store";
import Utils from "libs/utils";
import { OrthoViews, VolumeToolEnum } from "oxalis/constants";
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
} from "oxalis/model/actions/volumetracing_actions";
import { getActiveCellId, getVolumeTool } from "oxalis/model/accessors/volumetracing_accessor";
import VolumeTracingController from "oxalis/controller/annotations/volumetracing_controller";
import { connect } from "react-redux";
import type { OrthoViewType, Point2 } from "oxalis/constants";
import type { ModifierKeys } from "libs/input";

class VolumeTracingPlaneController extends PlaneControllerClass {
  // See comment in Controller class on general controller architecture.
  //
  // Volume Tracing Plane Controller:
  // Extends Plane controller to add controls that are specific to Volume
  // Tracing.

  volumeTracingController: VolumeTracingController;

  componentDidMount() {
    super.componentDidMount();
    this.volumeTracingController = new VolumeTracingController();

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
        const tool = getVolumeTool(Store.getState().tracing).get();
        if (tool === VolumeToolEnum.MOVE) {
          const viewportScale = Store.getState().userConfiguration.scale;
          this.movePlane([delta.x * -1 / viewportScale, delta.y * -1 / viewportScale, 0]);
        } else {
          Store.dispatch(addToLayerAction(this.calculateGlobalPos(pos)));
        }
      },

      leftMouseDown: (pos: Point2, plane: OrthoViewType, event: MouseEvent) => {
        if (!event.shiftKey) {
          Store.dispatch(startEditingAction(this.calculateGlobalPos(pos), plane));
        }
      },

      leftMouseUp: () => {
        Store.dispatch(finishEditingAction());
      },

      rightDownMove: (delta: Point2, pos: Point2) => {
        const tool = getVolumeTool(Store.getState().tracing).get();
        if (tool !== VolumeToolEnum.MOVE) {
          Store.dispatch(addToLayerAction(this.calculateGlobalPos(pos)));
        }
      },

      rightMouseDown: (pos: Point2, plane: OrthoViewType, event: JQueryInputEventObject) => {
        if (!event.shiftKey) {
          this.volumeTracingController.enterDeleteMode();
          Store.dispatch(startEditingAction(this.calculateGlobalPos(pos), plane));
        }
      },

      rightMouseUp: () => {
        Store.dispatch(finishEditingAction());
        this.volumeTracingController.restoreAfterDeleteMode();
      },

      leftClick: (pos: Point2, plane: OrthoViewType, event: MouseEvent) => {
        if (event.shiftKey) {
          const cellId = Model.getSegmentationBinary().cube.getDataValue(
            this.calculateGlobalPos(pos),
          );

          this.volumeTracingController.handleCellSelection(cellId);
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
}

export default connect(mapStateToProps)(VolumeTracingPlaneController);
