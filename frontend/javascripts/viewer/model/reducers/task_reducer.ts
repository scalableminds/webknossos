import update from "immutability-helper";
import type { Action } from "viewer/model/actions/actions";
import type { WebknossosState } from "viewer/store";

function TaskReducer(state: WebknossosState, action: Action): WebknossosState {
  switch (action.type) {
    case "SET_TASK": {
      return update(state, {
        task: {
          $set: action.task,
        },
      });
    }

    default:
      return state;
  }
}

export default TaskReducer;
