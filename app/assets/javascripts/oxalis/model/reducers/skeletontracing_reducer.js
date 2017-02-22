/**
 * settings_reducer.js
 * @flow
 */

import update from "immutability-helper";
import TracingParser from "oxalis/model/skeletontracing/tracingparser";
import type { OxalisState } from "oxalis/store";
import type { SkeletonTracingActionTypes } from "oxalis/model/actions/skeletontracing_actions";

function SkeletonTracingReducer(state: OxalisState, action: SkeletonTracingActionTypes): OxalisState {
  switch (action.type) {
    case "INITIALIZE_SKELETONTRACING": {
      const skeletonTracing = TracingParser.parse(action.tracing);
      return update(state, { skeletonTracing: { $set: skeletonTracing } });
    }

    default:
      // pass;
  }

  return state;
}

export default SkeletonTracingReducer;
