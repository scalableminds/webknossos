/**
 * save_reducer.js
 * @flow
 */

import update from "immutability-helper";
import type { OxalisState } from "oxalis/store";
import type { SaveActionTypes } from "oxalis/model/actions/save_actions";
import type { ActionWithTimestamp } from "oxalis/model/helpers/timestamp_middleware";

function SaveReducer(state: OxalisState, action: ActionWithTimestamp<SaveActionTypes>): OxalisState {
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

    default:
      return state;
  }
}

export default SaveReducer;
