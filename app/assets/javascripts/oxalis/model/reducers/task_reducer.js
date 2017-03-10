/**
 * task_reducer.js
 * @flow
 */

import update from "immutability-helper";
import type { OxalisState } from "oxalis/store";
import type { TaskActionTypes } from "oxalis/model/actions/task_actions";
import type { ActionWithTimestamp } from "oxalis/model/helpers/timestamp_middleware";

function TaskReducer(state: OxalisState, action: ActionWithTimestamp<TaskActionTypes>): OxalisState {
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
