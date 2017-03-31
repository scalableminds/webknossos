// @flow

import update from "immutability-helper";
import type { OxalisState, VolumeTracingType } from "oxalis/store";
import type { VolumeTracingActionType } from "oxalis/model/actions/volumetracing_actions";
import type { ActionWithTimestamp } from "oxalis/model/helpers/timestamp_middleware";
import { getVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { setMode } from "oxalis/model/reducers/volumetracing_reducer_helpers";
import Constants from "oxalis/constants";

function reduceSetMode(state, volumeTracing, newMode) {
  return setMode(state, volumeTracing, newMode)
    .map(mode =>
      update(state, { tracing: { viewMode: { $set: mode } } }))
    .getOrElse(state);
}

function VolumeTracingReducer(state: OxalisState, action: ActionWithTimestamp<VolumeTracingActionType>): OxalisState {
  switch (action.type) {
    case "INITIALIZE_VOLUMETRACING": {
      const restrictions = Object.assign({}, action.tracing.restrictions, action.tracing.content.settings);
      // const { contentData } = action.tracing.content;

      const volumeTracing: VolumeTracingType = {
        type: "volume",
        activeCellId: 0,
        cubes: [],
        controlMode: "Trace",
        restrictions,
        viewMode: 0,
        name: action.tracing.dataSetName,
        tracingType: action.tracing.typ,
        tracingId: action.tracing.id,
        version: action.tracing.version,
      };

      return update(state, { tracing: { $set: volumeTracing } });
    }
    default:
      // pass
  }
  console.log(action.type);
  return getVolumeTracing(state.tracing).map((volumeTracing) => {
    switch (action.type) {
      case "SET_MODE": {
        return reduceSetMode(state, volumeTracing, action.mode);
      }

      case "TOGGLE_MODE": {
        const newMode = volumeTracing.viewMode === Constants.VOLUME_MODE_TRACE ?
            Constants.VOLUME_MODE_MOVE :
            Constants.VOLUME_MODE_TRACE;
        return reduceSetMode(state, volumeTracing, newMode);
      }

      default:
        return state;
    }
  }).getOrElse(state);
}

export default VolumeTracingReducer;
