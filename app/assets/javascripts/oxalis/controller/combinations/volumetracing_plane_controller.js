/**
 * volumetracing_plane_controller.js
 * @flow
 */

import _ from "lodash";
import Utils from "libs/utils";
import constants, { OrthoViews } from "oxalis/constants";
import type { OrthoViewType } from "oxalis/constants";
import VolumeTracingController from "oxalis/controller/annotations/volumetracing_controller";
import PlaneController from "oxalis/controller/viewmodes/plane_controller";
import type SceneController from "oxalis/controller/scene_controller";
import type Model, { BoundingBoxType } from "oxalis/model";
import type View from "oxalis/view";

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

    this.listenTo(this.model.flycam, "positionChanged", () => this.render3dCell(this.model.volumeTracing.getActiveCellId()));
    this.listenTo(this.model.flycam, "zoomStepChanged", () => this.render3dCell(this.model.volumeTracing.getActiveCellId()));

    this.listenTo(this.model.user, "change:isosurfaceDisplay", () => { this.render3dCell(this.model.volumeTracing.getActiveCellId()); });
    this.listenTo(this.model.user, "change:isosurfaceBBsize", () => { this.render3dCell(this.model.volumeTracing.getActiveCellId()); });
    this.listenTo(this.model.user, "change:isosurfaceResolution", () => { this.render3dCell(this.model.volumeTracing.getActiveCellId()); });
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

    controls.leftMouseDown(pos(100, 100), 0, {});
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
    pos = this.model.flycam.getPosition();
    pos[2]++;
    this.model.flycam.setPosition(pos);
    await Utils.sleep(100);
    await this.simulateTracing();
  };


  getPlaneMouseControls(planeId: OrthoViewType): Object {
    return _.extend(super.getPlaneMouseControls(planeId), {

      leftDownMove: (delta, pos) => {
        if (this.model.volumeTracing.mode === constants.VOLUME_MODE_MOVE) {
          this.move([
            (delta.x * this.model.user.getMouseInversionX()) / this.planeView.scaleFactor,
            (delta.y * this.model.user.getMouseInversionY()) / this.planeView.scaleFactor,
            0,
          ]);
        } else {
          this.model.volumeTracing.addToLayer(this.calculateGlobalPos(pos));
        }
      },

      leftMouseDown: (pos, plane, event) => {
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

      rightDownMove: (delta, pos) => {
        if (this.model.volumeTracing.mode === constants.VOLUME_MODE_TRACE) {
          this.model.volumeTracing.addToLayer(this.calculateGlobalPos(pos));
        }
      },

      rightMouseDown: (pos, plane) => {
        this.volumeTracingController.enterDeleteMode();
        this.model.volumeTracing.startEditing(plane);
        this.adjustSegmentationOpacity();
      },

      rightMouseUp: () => {
        this.model.volumeTracing.finishLayer();
        this.volumeTracingController.restoreAfterDeleteMode();
      },

      leftClick: (pos) => {
        const cellId = this.model.getSegmentationBinary().cube.getDataValue(this.calculateGlobalPos(pos));

        this.volumeTracingController.handleCellSelection(cellId);
      },
    });
  }


  adjustSegmentationOpacity(): void {
    if (this.model.user.get("segmentationOpacity") < 10) {
      this.model.user.set("segmentationOpacity", 50);
    }
  }


  getKeyboardControls(): Object {
    return _.extend(super.getKeyboardControls(), {
      c: () => this.model.volumeTracing.createCell(),
    });
  }


  render3dCell(id: number): void {
    if (!this.model.user.get("isosurfaceDisplay")) {
      this.sceneController.removeShapes();
      return;
    }
    const bb = this.model.flycam.getViewportBoundingBox();
    const res = this.model.user.get("isosurfaceResolution");
    this.sceneController.showShapes(this.scaleIsosurfaceBB(bb), res, id);
  }

  scaleIsosurfaceBB(bb: BoundingBoxType): BoundingBoxType {
    const factor = this.model.user.get("isosurfaceBBsize");
    for (let i = 0; i <= 2; i++) {
      const width = bb.max[i] - bb.min[i];
      const diff = ((factor - 1) * width) / 2;
      bb.min[i] -= diff;
      bb.max[i] += diff;
    }
    return bb;
  }
}

export default VolumeTracingPlaneController;
