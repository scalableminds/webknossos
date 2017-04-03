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
import type { OrthoViewType, Point2 } from "oxalis/constants";
import VolumeTracingController from "oxalis/controller/annotations/volumetracing_controller";
import PlaneController from "oxalis/controller/viewmodes/plane_controller";
import type SceneController from "oxalis/controller/scene_controller";
import type Model, { BoundingBoxType } from "oxalis/model";
import type View from "oxalis/view";
import { getPosition, getViewportBoundingBox } from "oxalis/model/accessors/flycam_accessor";
import { setPositionAction } from "oxalis/model/actions/flycam_actions";
import { createCellAction, setModeAction } from "oxalis/model/actions/volumetracing_actions";
import { getActiveCellId } from "oxalis/model/accessors/volumetracing_accessor";

class VolumeTracingPlaneController extends PlaneController {

  // See comment in Controller class on general controller architecture.
  //
  // Volume Tracing Plane Controller:
  // Extends Plane controller to add controls that are specific to Volume
  // Tracing.

  volumeTracingController: VolumeTracingController;

  constructor(model: Model, view: View, sceneController: SceneController, volumeTracingController: VolumeTracingController) {
    super(model, view, sceneController);
    this.volumeTracingController = volumeTracingController;

    // Todo: Do not render on every store change
    Store.subscribe(() => {
      getActiveCellId(Store.getState().tracing).chain(cellId =>
        this.render3dCell(cellId),
      );
    });

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

        if (this.model.volumeTracing.mode === constants.VOLUME_MODE_MOVE) {
          this.move([
            (delta.x * mouseInversionX) / this.planeView.scaleFactor,
            (delta.y * mouseInversionY) / this.planeView.scaleFactor,
            0,
          ]);
        } else {
          this.model.volumeTracing.addToLayer(this.calculateGlobalPos(pos));
        }
      },

      leftMouseDown: (pos: Point2, plane: OrthoViewType, event: JQueryInputEventObject) => {
        if (event.shiftKey) {
          this.volumeTracingController.enterDeleteMode();
        }
        this.model.volumeTracing.startEditing(plane);
      },

      leftMouseUp: () => {
        this.model.volumeTracing.finishLayer();
        this.volumeTracingController.restoreAfterDeleteMode();
      },

      rightDownMove: (delta: Point2, pos: Point2) => {
        if (this.model.volumeTracing.mode === constants.VOLUME_MODE_TRACE) {
          this.model.volumeTracing.addToLayer(this.calculateGlobalPos(pos));
        }
      },

      rightMouseDown: (pos: Point2, plane: OrthoViewType) => {
        this.volumeTracingController.enterDeleteMode();
        this.model.volumeTracing.startEditing(plane);
      },

      rightMouseUp: () => {
        this.model.volumeTracing.finishLayer();
        this.volumeTracingController.restoreAfterDeleteMode();
      },

      leftClick: (pos: Point2) => {
        const cellId = this.model.getSegmentationBinary().cube.getDataValue(this.calculateGlobalPos(pos));

        this.volumeTracingController.handleCellSelection(cellId);
      },
    });
  }


  adjustSegmentationOpacity(): void {
    if (Store.getState().datasetConfiguration.segmentationOpacity < 10) {
      Toast.warning("Your setting for \"segmentation opacity\" is set very low.<br />Increase it for better visibility while volume tracing.");
    }
  }


  getKeyboardControls(): Object {
    return _.extend(super.getKeyboardControls(), {
      c: () => Store.dispatch(createCellAction()),
    });
  }


  render3dCell(id: number): void {
    if (!Store.getState().userConfiguration.isosurfaceDisplay) {
      this.sceneController.removeShapes();
      return;
    }
    const bb = getViewportBoundingBox(Store.getState());
    const res = Store.getState().userConfiguration.isosurfaceResolution;
    this.sceneController.showShapes(this.scaleIsosurfaceBB(bb), res, id);
  }

  scaleIsosurfaceBB(bb: BoundingBoxType): BoundingBoxType {
    const factor = Store.getState().userConfiguration.isosurfaceBBsize;
    const result = {
      min: [0, 0, 0],
      max: [0, 0, 0],
    };
    for (let i = 0; i <= 2; i++) {
      const width = bb.max[i] - bb.min[i];
      const diff = ((factor - 1) * width) / 2;
      result.min[i] = bb.min[i] - diff;
      result.max[i] = bb.max[i] + diff;
    }
    return result;
  }
}

export default VolumeTracingPlaneController;
