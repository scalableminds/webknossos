/**
 * task_reducer.js
 * @flow
 */

import update from "immutability-helper";
import type { OxalisState } from "oxalis/store";
import type { ActionType } from "oxalis/model/actions/actions";

function TaskReducer(state: OxalisState, action: ActionType): OxalisState {
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
