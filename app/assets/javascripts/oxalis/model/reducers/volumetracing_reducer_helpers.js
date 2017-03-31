/**
 * volumetracing_reducer_helpers.js
 * @flow
 *
 * THESE HELPERFUNCTIONS MUST ONLY BE CALLED FROM A REDUCER
 *
 */

import type { OxalisState, VolumeTracingType } from "oxalis/store";
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
