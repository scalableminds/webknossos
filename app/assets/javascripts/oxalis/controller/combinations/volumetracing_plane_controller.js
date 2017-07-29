/**
 * volumetracing_plane_controller.js
 * @flow
 */
/* globals JQueryInputEventObject:false */

import _ from "lodash";
import Store from "oxalis/store";
import Utils from "libs/utils";
import Toast from "libs/toast";
import constants, { OrthoViews } from "oxalis/constants";
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
  setModeAction,
  startEditingAction,
  addToLayerAction,
  finishEditingAction,
} from "oxalis/model/actions/volumetracing_actions";
import {
  getActiveCellId,
  getVolumeTraceOrMoveMode,
} from "oxalis/model/accessors/volumetracing_accessor";
import type { OrthoViewType, Point2 } from "oxalis/constants";
import VolumeTracingController from "oxalis/controller/annotations/volumetracing_controller";
import { connect } from "react-redux";

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

    // TODO: This should be put in a saga with `take('INITIALIZE_SETTINGS')`as pre-condition
    setTimeout(this.adjustSegmentationOpacity, 500);
  }

  simulateTracing = async (): Promise<void> => {
    Store.dispatch(setModeAction(constants.VOLUME_MODE_TRACE));

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
        const mouseInversionX = Store.getState().userConfiguration.inverseX ? 1 : -1;
        const mouseInversionY = Store.getState().userConfiguration.inverseY ? 1 : -1;

        const mode = getVolumeTraceOrMoveMode(Store.getState().tracing).get();
        if (mode === constants.VOLUME_MODE_MOVE) {
          const viewportScale = Store.getState().userConfiguration.scale;
          this.move([
            delta.x * mouseInversionX / viewportScale,
            delta.y * mouseInversionY / viewportScale,
            0,
          ]);
        } else {
          Store.dispatch(addToLayerAction(this.calculateGlobalPos(pos)));
        }
      },

      leftMouseDown: (pos: Point2, plane: OrthoViewType, event: JQueryInputEventObject) => {
        if (event.shiftKey) {
          this.volumeTracingController.enterDeleteMode();
        }
        Store.dispatch(startEditingAction(plane));
      },

      leftMouseUp: () => {
        Store.dispatch(finishEditingAction());
        this.volumeTracingController.restoreAfterDeleteMode();
      },

      rightDownMove: (delta: Point2, pos: Point2) => {
        const mode = getVolumeTraceOrMoveMode(Store.getState().tracing).get();
        if (mode === constants.VOLUME_MODE_TRACE) {
          Store.dispatch(addToLayerAction(this.calculateGlobalPos(pos)));
        }
      },

      rightMouseDown: (pos: Point2, plane: OrthoViewType) => {
        this.volumeTracingController.enterDeleteMode();
        Store.dispatch(startEditingAction(plane));
      },

      rightMouseUp: () => {
        Store.dispatch(finishEditingAction());
        this.volumeTracingController.restoreAfterDeleteMode();
      },

      leftClick: (pos: Point2) => {
        const cellId = Model.getSegmentationBinary().cube.getDataValue(
          this.calculateGlobalPos(pos),
        );

        this.volumeTracingController.handleCellSelection(cellId);
      },
    });
  }

  adjustSegmentationOpacity(): void {
    if (Store.getState().datasetConfiguration.segmentationOpacity < 10) {
      Toast.warning(
        'Your setting for "segmentation opacity" is set very low.<br />Increase it for better visibility while volume tracing.',
      );
    }
  }

  getKeyboardControls(): Object {
    return _.extend(super.getKeyboardControls(), {
      c: () => Store.dispatch(createCellAction()),
    });
  }
}

export default connect(mapStateToProps)(VolumeTracingPlaneController);
