// @flow

import update from "immutability-helper";
import type { OxalisState, ReadOnlyTracingType } from "oxalis/store";
import type { ActionType } from "oxalis/model/actions/actions";
import { convertBoundingBox } from "oxalis/model/reducers/reducer_helpers";

function ReadOnlyTracingReducer(state: OxalisState, action: ActionType): OxalisState {
  switch (action.type) {
    case "INITIALIZE_READONLYTRACING": {
      const restrictions = Object.assign(
        {},
        action.annotation.restrictions,
        action.annotation.settings,
      );

      const readonlyTracing: ReadOnlyTracingType = {
        type: "readonly",
        restrictions,
        name: action.annotation.name,
        tracingType: "View",
        tracingId: action.annotation.id,
        version: action.tracing.version,
        boundingBox: convertBoundingBox(action.tracing.boundingBox),
      };

      return update(state, { tracing: { $set: readonlyTracing } });
    }
    default:
    // pass
  }
  return state;
}

export default ReadOnlyTracingReducer;
