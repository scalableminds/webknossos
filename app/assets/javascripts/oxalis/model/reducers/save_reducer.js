/**
 * save_reducer.js
 * @flow
 */

import update from "immutability-helper";
import type { OxalisState } from "oxalis/store";
import type { ActionType } from "oxalis/model/actions/actions";

function SaveReducer(state: OxalisState, action: ActionType): OxalisState {
  switch (action.type) {
    case "PUSH_SAVE_QUEUE": {
      return update(state, {
        save: { queue: { $push: action.items } },
      });
    }

    case "SHIFT_SAVE_QUEUE": {
      if (action.count > 0) {
        return update(state, {
          save: { queue: { $set: state.save.queue.slice(action.count) } },
        });
      }
      return state;
    }

    case "SET_SAVE_BUSY": {
      return update(state, {
        save: { isBusy: { $set: action.isBusy } },
      });
    }

    case "SET_LAST_SAVE_TIMESTAMP": {
      return update(state, {
        save: { lastSaveTimestamp: { $set: action.timestamp } },
      });
    }

    case "SET_VERSION_NUMBER": {
      return update(state, { tracing: { version: { $set: action.version } } });
    }

    default:
      return state;
  }
}

export default SaveReducer;
