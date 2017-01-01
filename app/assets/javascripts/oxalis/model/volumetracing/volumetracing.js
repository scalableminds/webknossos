import Backbone from "backbone";
import VolumeCell from "./volumecell";
import VolumeLayer from "./volumelayer";
import Dimensions from "../dimensions";
import RestrictionHandler from "../helpers/restriction_handler";
import Drawing from "libs/drawing";
import VolumeTracingStateLogger from "./volumetracing_statelogger";
import Constants from "../../constants";

class VolumeTracing {

  constructor(tracing, flycam, flycam3d, binary) {

    this.flycam = flycam;
    this.flycam3d = flycam3d;
    this.binary = binary;
    _.extend(this, Backbone.Events);

    this.contentData  = tracing.content.contentData;
    this.restrictionHandler = new RestrictionHandler(tracing.restrictions);
    this.mode = Constants.VOLUME_MODE_MOVE;

    this.cells        = [];
    this.activeCell   = null;
    this.currentLayer = null;        // Layer currently edited
    this.idCount      = this.contentData.nextCell || 1;
    this.lastCentroid = null;

    this.stateLogger  = new VolumeTracingStateLogger(
      this.flycam, tracing.version, tracing.id, tracing.typ,
      tracing.restrictions.allowUpdate,
      this, this.binary.pushQueue
    );

    this.createCell(this.contentData.activeCell);

    this.listenTo(this.binary.cube, "newMapping", function() {
      return this.trigger("newActiveCell", this.getActiveCellId());
    });

    // For testing
    window.setAlpha = v => Drawing.setAlpha(v);
    window.setSmoothLength = v => Drawing.setSmoothLength(v);
  }


  setMode(mode) {

    this.mode = mode;
    return this.trigger("change:mode", this.mode);
  }


  toggleMode() {

    return this.setMode(
      this.mode === Constants.VOLUME_MODE_TRACE ?
        Constants.VOLUME_MODE_MOVE
      :
        Constants.VOLUME_MODE_TRACE
    );
  }


  createCell(id) {

    let newCell;
    if (id == null) {
      id = this.idCount++;
    }

    this.cells.push( newCell = new VolumeCell(id) );
    this.setActiveCell( newCell.id );
    return this.currentLayer = null;
  }


  startEditing(planeId) {
    // Return, if layer was actually started

    if (!this.restrictionHandler.updateAllowed()) { return false; }

    if ((typeof currentLayer !== 'undefined' && currentLayer !== null) || this.flycam.getIntegerZoomStep() > 0) {
      return false;
    }

    const pos = Dimensions.roundCoordinate(this.flycam.getPosition());
    const thirdDimValue = pos[Dimensions.thirdDimensionForPlane(planeId)];
    this.currentLayer = new VolumeLayer(planeId, thirdDimValue);
    return true;
  }


  addToLayer(pos) {

    if (!this.restrictionHandler.updateAllowed()) { return; }

    if (this.currentLayer == null) {
      return;
    }

    this.currentLayer.addContour(pos);
    return this.trigger("updateLayer", this.getActiveCellId(), this.currentLayer.getSmoothedContourList());
  }


  finishLayer() {

    if (!this.restrictionHandler.updateAllowed()) { return; }

    if ((this.currentLayer == null) || this.currentLayer.isEmpty()) {
      return;
    }

    const start = (new Date()).getTime();
    this.currentLayer.finish();
    const iterator = this.currentLayer.getVoxelIterator();
    const labelValue = this.activeCell ? this.activeCell.id : 0;
    this.binary.cube.labelVoxels(iterator, labelValue);
    console.log("Labeling time:", ((new Date()).getTime() - start));

    this.updateDirection(this.currentLayer.getCentroid());
    this.currentLayer = null;

    return this.trigger("volumeAnnotated");
  }


  updateDirection(centroid) {
    if (this.lastCentroid != null) {
      this.flycam.setDirection([
        centroid[0] - this.lastCentroid[0],
        centroid[1] - this.lastCentroid[1],
        centroid[2] - this.lastCentroid[2]
      ]);
    }
    return this.lastCentroid = centroid;
  }


  getActiveCellId() {

    if (this.activeCell != null) {
      return this.activeCell.id;
    } else {
      return 0;
    }
  }


  getMappedActiveCellId() {

    return this.binary.cube.mapId(this.getActiveCellId());
  }


  setActiveCell(id) {

    this.activeCell = null;
    for (let cell of this.cells) {
      if (cell.id === id) { this.activeCell = cell; }
    }

    if ((this.activeCell == null) && id > 0) {
      this.createCell(id);
    }

    return this.trigger("newActiveCell", id);
  }
}

export default VolumeTracing;
