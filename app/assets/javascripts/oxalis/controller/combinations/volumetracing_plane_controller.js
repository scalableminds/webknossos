import _ from "lodash";
import Constants from "oxalis/constants";
import PlaneController from "../viewmodes/plane_controller";
import VolumeTracingController from "../annotations/volumetracing_controller";

class VolumeTracingPlaneController extends PlaneController {

  // See comment in Controller class on general controller architecture.
  //
  // Volume Tracing Plane Controller:
  // Extends Plane controller to add controls that are specific to Volume
  // Tracing.


  constructor(model, view, sceneController, volumeTracingController) {

    this.model = model;
    this.view = view;
    this.sceneController = sceneController;
    this.volumeTracingController = volumeTracingController;
    super(this.model, this.view, this.sceneController);

    this.simulateTracing = this.simulateTracing.bind(this);
    this.listenTo(this.model.flycam, "positionChanged", () => {
      return this.render3dCell(this.model.volumeTracing.getActiveCellId());
    }
    );
    this.listenTo(this.model.flycam, "zoomStepChanged", () => {
      return this.render3dCell(this.model.volumeTracing.getActiveCellId());
    }
    );

    this.listenTo(this.model.user, "isosurfaceDisplayChanged", function() { return this.render3dCell(this.model.volumeTracing.getActiveCellId()); });
    this.listenTo(this.model.user, "isosurfaceBBsizeChanged", function() { return this.render3dCell(this.model.volumeTracing.getActiveCellId()); });
    this.listenTo(this.model.user, "isosurfaceResolutionChanged", function() { return this.render3dCell(this.model.volumeTracing.getActiveCellId()); });
    this.listenTo(this.model.volumeTracing, "newActiveCell", function(id) {
      id = this.model.volumeTracing.getActiveCellId();
      if (id > 0) {
        return this.render3dCell(id);
      }});
  }


  simulateTracing() {

    this.model.volumeTracing.setMode(Constants.VOLUME_MODE_TRACE);

    const controls = this.getPlaneMouseControls();
    let pos = (x, y) => ({x, y});

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
            }
            );
          }
          );
        }
        );
      }
      );
    }
    );
  }


  getPlaneMouseControls(planeId) {

    return _.extend(super.getPlaneMouseControls(planeId), {

      leftDownMove : (delta, pos, plane, event) => {

        if (this.model.volumeTracing.mode === Constants.VOLUME_MODE_MOVE) {
          return this.move([
            (delta.x * this.model.user.getMouseInversionX()) / this.planeView.scaleFactor,
            (delta.y * this.model.user.getMouseInversionY()) / this.planeView.scaleFactor,
            0
          ]);
        } else {
          return this.model.volumeTracing.addToLayer( this.calculateGlobalPos(pos));
        }
      },

      leftMouseDown : (pos, plane, event) => {

        if (event.shiftKey) {
          this.volumeTracingController.enterDeleteMode();
        }
        this.model.volumeTracing.startEditing(plane);
        return this.adjustSegmentationOpacity();
      },

      leftMouseUp : () => {

        this.model.volumeTracing.finishLayer();
        return this.volumeTracingController.restoreAfterDeleteMode();
      },

      rightDownMove : (delta, pos, plane, event) => {

        return this.model.volumeTracing.addToLayer( this.calculateGlobalPos(pos));
      },

      rightMouseDown : (pos, plane, event) => {

        this.volumeTracingController.enterDeleteMode();
        this.model.volumeTracing.startEditing(plane);
        return this.adjustSegmentationOpacity();
      },

      rightMouseUp : () => {

        this.model.volumeTracing.finishLayer();
        return this.volumeTracingController.restoreAfterDeleteMode();
      },

      leftClick : (pos, plane, event) => {

        const cellId = this.model.getSegmentationBinary().cube.getDataValue(
                  this.calculateGlobalPos( pos ));

        return this.volumeTracingController.handleCellSelection( cellId );
      }
    }
    );
  }


  adjustSegmentationOpacity() {

    if (this.model.user.get("segmentationOpacity") < 10) {
      return this.model.user.set("segmentationOpacity", 50);
    }
  }


  getKeyboardControls() {

    return _.extend(super.getKeyboardControls(), {

      "c" : () => {
        return this.model.volumeTracing.createCell();
      }
    }
    );
  }


  render3dCell(id) {

    if (!this.model.user.get("isosurfaceDisplay")) {
      return this.sceneController.removeShapes();
    } else {
      const bb = this.model.flycam.getViewportBoundingBox();
      const res = this.model.user.get("isosurfaceResolution");
      return this.sceneController.showShapes(this.scaleIsosurfaceBB(bb), res, id);
    }
  }

  scaleIsosurfaceBB(bb) {
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
