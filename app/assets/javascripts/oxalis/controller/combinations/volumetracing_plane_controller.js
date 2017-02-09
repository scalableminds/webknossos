/**
 * volumetracing_plane_controller.js
 * @flow weak
 */

import _ from "lodash";
import Store from "oxalis/store";
import Constants from "oxalis/constants";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import VolumeTracingController from "oxalis/controller/annotations/volumetracing_controller";
import PlaneController from "../viewmodes/plane_controller";

class VolumeTracingPlaneController extends PlaneController {

  // See comment in Controller class on general controller architecture.
  //
  // Volume Tracing Plane Controller:
  // Extends Plane controller to add controls that are specific to Volume
  // Tracing.

  volumeTracingController: VolumeTracingController;

  constructor(model, view, sceneController, volumeTracingController) {
    super(model, view, sceneController);
    this.volumeTracingController = volumeTracingController;

    this.listenTo(this.model.flycam, "positionChanged", () => this.render3dCell(this.model.volumeTracing.getActiveCellId()),
    );
    this.listenTo(this.model.flycam, "zoomStepChanged", () => this.render3dCell(this.model.volumeTracing.getActiveCellId()),
    );

    Store.subscribe(() => {
      this.render3dCell(this.model.volumeTracing.getActiveCellId());
    });
    this.listenTo(this.model.volumeTracing, "newActiveCell", function (id) {
      id = this.model.volumeTracing.getActiveCellId();
      if (id > 0) {
        this.render3dCell(id);
      }
    });
  }


  simulateTracing = () => {
    this.model.volumeTracing.setMode(Constants.VOLUME_MODE_TRACE);

    const controls = this.getPlaneMouseControls();
    let pos = (x, y) => ({ x, y });

    controls.leftMouseDown(pos(100, 100), 0, {});

    return _.defer(() => {
      controls.leftDownMove(null, pos(200, 100));
      return _.defer(() => {
        controls.leftDownMove(null, pos(200, 200));
        return _.defer(() => {
          controls.leftDownMove(null, pos(100, 200));
          return _.defer(() => {
            controls.leftDownMove(null, pos(100, 100));
            controls.leftMouseUp();
            return _.defer(() => {
              pos = this.model.flycam.getPosition();
              pos[2]++;
              this.model.flycam.setPosition(pos);
              return _.defer(this.simulateTracing);
            },
            );
          },
          );
        },
        );
      },
      );
    },
    );
  };


  getPlaneMouseControls(planeId) {
    const mouseInversionX = Store.getState().userConfiguration.inverseX ? 1 : -1;
    const mouseInversionY = Store.getState().userConfiguration.inverseY ? 1 : -1;
    return _.extend(super.getPlaneMouseControls(planeId), {

      leftDownMove: (delta, pos) => {
        if (this.model.volumeTracing.mode === Constants.VOLUME_MODE_MOVE) {
          this.move([
            (delta.x * mouseInversionX) / this.planeView.scaleFactor,
            (delta.y * mouseInversionY) / this.planeView.scaleFactor,
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
        if (this.model.volumeTracing.mode === Constants.VOLUME_MODE_TRACE) {
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
    },
    );
  }


  adjustSegmentationOpacity() {
    if (Store.getState().userConfiguration.segmentationOpacity < 10) {
      Store.dispatch(updateUserSettingAction("segmentationOpacity", 50));
    }
  }


  getKeyboardControls() {
    return _.extend(super.getKeyboardControls(), {
      c: () => this.model.volumeTracing.createCell(),
    });
  }


  render3dCell(id) {
    if (!Store.getState().userConfiguration.isosurfaceDisplay) {
      this.sceneController.removeShapes();
      return;
    }
    const bb = this.model.flycam.getViewportBoundingBox();
    const res = Store.getState().userConfiguration.isosurfaceResolution;
    this.sceneController.showShapes(this.scaleIsosurfaceBB(bb), res, id);
  }

  scaleIsosurfaceBB(bb) {
    const factor = Store.getState().userConfiguration.isosurfaceBBsize;
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
