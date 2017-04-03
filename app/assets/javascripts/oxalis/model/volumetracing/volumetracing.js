/**
 * volumetracing.js
 * @flow
 */

import _ from "lodash";
import Backbone from "backbone";
import Drawing from "libs/drawing";
import VolumeLayer from "oxalis/model/volumetracing/volumelayer";
import VolumeTracingStateLogger from "oxalis/model/volumetracing/volumetracing_statelogger";
import Dimensions from "oxalis/model/dimensions";
import RestrictionHandler from "oxalis/model/helpers/restriction_handler";
import Binary from "oxalis/model/binary";
import Store from "oxalis/store";
import { getPosition, getIntegerZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { setRotationAction } from "oxalis/model/actions/flycam_actions";

import type { Vector3, VolumeModeType, OrthoViewType } from "oxalis/constants";
import type { Tracing, VolumeContentDataType } from "oxalis/model";
import type { VolumeCellType } from "oxalis/store";

class VolumeTracing {

  binary: Binary;
  contentData: VolumeContentDataType;
  restrictionHandler: RestrictionHandler;
  mode: VolumeModeType;
  // cells: Array<VolumeCell>;
  activeCell: ?VolumeCellType;
  currentLayer: ?VolumeLayer;
  idCount: number;
  lastCentroid: ?Vector3;
  stateLogger: VolumeTracingStateLogger;

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;
  trigger: Function;
  on: Function;
  off: Function;

  constructor(tracing: Tracing<VolumeContentDataType>, binary: Binary) {
    this.binary = binary;
    _.extend(this, Backbone.Events);

    // this.contentData = tracing.content.contentData;
    this.restrictionHandler = new RestrictionHandler(tracing.restrictions);
    // this.mode = Constants.VOLUME_MODE_MOVE;

    // this.cells = [];
    // this.activeCell = null;
    this.currentLayer = null; // Layer currently edited
    // if (this.contentData.nextCell != null) {
    //   this.idCount = this.contentData.nextCell;
    // } else {
    //   this.idCount = 1;
    // }
    this.lastCentroid = null;

    this.stateLogger = new VolumeTracingStateLogger(
      tracing.version, tracing.id, tracing.typ,
      tracing.restrictions.allowUpdate,
      this, this.binary.pushQueue,
    );

    // this.createCell(this.contentData.activeCell);

    this.listenTo(this.binary.cube, "newMapping", function () {
      this.trigger("newActiveCell", this.getActiveCellId());
    });

    // For testing
    window.setAlpha = v => Drawing.setAlpha(v);
    window.setSmoothLength = v => Drawing.setSmoothLength(v);
  }


  // createCell(id: ?number) {
  //   let newCell;
  //   if (id == null) {
  //     id = this.idCount++;
  //   }

  //   this.cells.push(newCell = new VolumeCell(id));
  //   this.setActiveCell(newCell.id);
  //   this.currentLayer = null;
  // }


  startEditing(planeId: OrthoViewType) {
    // Return, if layer was actually started

    if (!this.restrictionHandler.updateAllowed()) { return false; }

    if ((typeof this.currentLayer !== "undefined" && this.currentLayer !== null) || getIntegerZoomStep(Store.getState()) > 1) {
      return false;
    }

    const pos = Dimensions.roundCoordinate(getPosition(Store.getState().flycam));
    const thirdDimValue = pos[Dimensions.thirdDimensionForPlane(planeId)];
    this.currentLayer = new VolumeLayer(planeId, thirdDimValue);
    return true;
  }


  addToLayer(pos: Vector3) {
    if (!this.restrictionHandler.updateAllowed()) { return; }

    const currentLayer = this.currentLayer;

    if (currentLayer == null) {
      return;
    }

    currentLayer.addContour(pos);
    // this.trigger("updateLayer", this.getActiveCellId(), currentLayer.getSmoothedContourList());
  }


  finishLayer() {
    if (!this.restrictionHandler.updateAllowed()) { return; }

    const currentLayer = this.currentLayer;

    if ((currentLayer == null) || currentLayer.isEmpty()) {
      return;
    }

    const start = (new Date()).getTime();
    currentLayer.finish();
    const iterator = currentLayer.getVoxelIterator();
    const labelValue = this.activeCell ? this.activeCell.id : 0;
    this.binary.cube.labelVoxels(iterator, labelValue);
    console.log("Labeling time:", ((new Date()).getTime() - start));

    this.updateDirection(currentLayer.getCentroid());
    this.currentLayer = null;

    this.trigger("volumeAnnotated");
  }


  updateDirection(centroid: Vector3) {
    if (this.lastCentroid != null) {
      Store.dispatch(setRotationAction([
        centroid[0] - this.lastCentroid[0],
        centroid[1] - this.lastCentroid[1],
        centroid[2] - this.lastCentroid[2],
      ]));
    }
    this.lastCentroid = centroid;
  }


  // getActiveCellId() {
  //   if (this.activeCell != null) {
  //     return this.activeCell.id;
  //   } else {
  //     return 0;
  //   }
  // }


  // getMappedActiveCellId() {
  //   return this.binary.cube.mapId(this.getActiveCellId());
  // }


  // setActiveCell(id: number) {
  //   this.activeCell = null;
  //   for (const cell of this.cells) {
  //     if (cell.id === id) { this.activeCell = cell; }
  //   }

  //   if ((this.activeCell == null) && id > 0) {
  //     this.createCell(id);
  //   }

  //   this.trigger("newActiveCell", id);
  // }
}

export default VolumeTracing;
