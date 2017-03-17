/**
 * volumetracing_plane_controller.js
 * @flow
 */
/* globals JQueryInputEventObject:false */

import _ from "lodash";
import Store from "oxalis/store";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import Utils from "libs/utils";
import constants, { OrthoViews } from "oxalis/constants";
import type { OrthoViewType, Point2 } from "oxalis/constants";
import VolumeTracingController from "oxalis/controller/annotations/volumetracing_controller";
import PlaneController from "oxalis/controller/viewmodes/plane_controller";
import type SceneController from "oxalis/controller/scene_controller";
import type Model, { BoundingBoxType } from "oxalis/model";
import type View from "oxalis/view";
import { getPosition } from "oxalis/model/accessors/flycam3d_accessor";
import { getViewportBoundingBox } from "oxalis/model/accessors/flycam2d_accessor";
import { setPositionAction } from "oxalis/model/actions/flycam_actions";

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

    Store.subscribe(() => {
      this.render3dCell(this.model.volumeTracing.getActiveCellId());
    });
    this.listenTo(this.model.volumeTracing, "newActiveCell", (id) => {
      id = this.model.volumeTracing.getActiveCellId();
      if (id > 0) {
        this.render3dCell(id);
      }
    });
  }


  simulateTracing = async (): Promise<void> => {
    this.model.volumeTracing.setMode(constants.VOLUME_MODE_TRACE);

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
        this.adjustSegmentationOpacity();
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
        this.adjustSegmentationOpacity();
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
    if (Store.getState().userConfiguration.segmentationOpacity < 10) {
      Store.dispatch(updateUserSettingAction("segmentationOpacity", 50));
    }
  }


  getKeyboardControls(): Object {
    return _.extend(super.getKeyboardControls(), {
      c: () => this.model.volumeTracing.createCell(),
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
