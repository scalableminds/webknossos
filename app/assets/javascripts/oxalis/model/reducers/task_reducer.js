/**
 * task_reducer.js
 * @flow
 */

import update from "immutability-helper";

import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState } from "oxalis/store";

function TaskReducer(state: OxalisState, action: Action): OxalisState {
  switch (action.type) {
    case "SET_TASK": {
      return update(state, {
        task: { $set: action.task },
      });
    }

    default:
      return state;
  }
}

export default TaskReducer;
