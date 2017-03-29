// @flow

import update from "immutability-helper";
import type { OxalisState, VolumeTracingType } from "oxalis/store";
import type { VolumeTracingActionType } from "oxalis/model/actions/volumetracing_actions";
import type { ActionWithTimestamp } from "oxalis/model/helpers/timestamp_middleware";


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
  return state;
}

export default VolumeTracingReducer;
