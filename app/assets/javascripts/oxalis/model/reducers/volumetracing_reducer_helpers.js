/**
 * volumetracing_reducer_helpers.js
 * @flow
 *
 * THESE HELPERFUNCTIONS MUST ONLY BE CALLED FROM A REDUCER
 *
 */

import type { OxalisState, VolumeTracingType, VolumeCellType } from "oxalis/store";
import type { VolumeModeType } from "oxalis/constants";
import Maybe from "data.maybe";
import Constants from "oxalis/constants";
import Toast from "libs/toast";
import { getIntegerZoomStep } from "oxalis/model/accessors/flycam_accessor";

export function setMode(state: OxalisState, volumeTracing: VolumeTracingType, mode: VolumeModeType) {
  if (mode === volumeTracing.viewMode) {
    return Maybe.Nothing();
  }
  if (mode === Constants.VOLUME_MODE_TRACE && getIntegerZoomStep(state) > 1) {
    Toast.warning("Volume tracing is not possible at this zoom level. Please zoom in further.");
    return Maybe.Nothing();
  }
  return Maybe.Just(mode);
}

export function setActiveCell(volumeTracing: VolumeTracingType, id: number) {
  let newActiveCell = volumeTracing.cells[id];
  let newIdCount = volumeTracing.idCount;

  if ((newActiveCell == null) && id > 0) {
    [newActiveCell, newIdCount] = createCell(volumeTracing, id).get();
  }

  return Maybe.Just([newActiveCell, newIdCount]);
}

export function createCell(volumeTracing: VolumeTracingType, id: ?number) {
  let newIdCount = volumeTracing.idCount;
  if (id == null) {
    id = newIdCount++;
  }

  // Create the new VolumeCell
  const cell: VolumeCellType = { id };

  // this.currentLayer = null;
  return Maybe.Just([cell, newIdCount]);
}
