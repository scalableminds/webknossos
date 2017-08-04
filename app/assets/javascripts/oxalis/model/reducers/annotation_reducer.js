// @flow

import update from "immutability-helper";

import type { OxalisState } from "oxalis/store";
import type { ActionType } from "oxalis/model/actions/actions";

function AnnotationReducer(state: OxalisState, action: ActionType): OxalisState {
  switch (action.type) {
    case "SET_TRACING_NAME": {
      debugger;
      return update(state, {
        tracing: {
          name: { $set: action.name },
        },
      });
    }

    default:
      return state;
  }
}

export default AnnotationReducer;
