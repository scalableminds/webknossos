/**
 * save_reducer.js
 * @flow
 */

import _ from "lodash";
import update from "immutability-helper";

import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState } from "oxalis/store";
import { getStats } from "oxalis/model/accessors/skeletontracing_accessor";
import Date from "libs/date";
import * as Utils from "libs/utils";
import { getActionLog } from "oxalis/model/helpers/action_logger_middleware";

function SaveReducer(state: OxalisState, action: Action): OxalisState {
  switch (action.type) {
    case "PUSH_SAVE_QUEUE": {
      // Only report tracing statistics, if a "real" update to the tracing happened
      const stats = _.some(action.items, ua => ua.name !== "updateTracing")
        ? Utils.toNullable(getStats(state.tracing))
        : null;
      const { items } = action;
      if (items.length > 0) {
        return update(state, {
          save: {
            queue: {
              [action.tracingType]: {
                $push: [
                  {
                    // Placeholder, the version number will be updated before sending to the server
                    version: -1,
                    timestamp: Date.now(),
                    actions: items,
                    stats,
                    // TODO: Redux Action Log context for debugging purposes. Remove this again if it is no longer needed.
                    info: JSON.stringify(getActionLog().slice(-50)),
                  },
                ],
              },
            },
            progressInfo: {
              totalActionCount: { $apply: count => count + items.length },
            },
          },
        });
      }
      return state;
    }

    case "SHIFT_SAVE_QUEUE": {
      const { count } = action;
      if (count > 0) {
        const processedQueueActions = _.sumBy(
          state.save.queue[action.tracingType].slice(0, count),
          batch => batch.actions.length,
        );
        const remainingQueue = state.save.queue[action.tracingType].slice(count);
        const otherQueue =
          state.save.queue[action.tracingType === "skeleton" ? "skeleton" : "volume"];
        const resetCounter = remainingQueue.length === 0 && otherQueue.length === 0;
        return update(state, {
          save: {
            queue: { [action.tracingType]: { $set: remainingQueue } },
            progressInfo: {
              // Reset progress counters if the queue is empty. Otherwise,
              // increase processedActionCount and leave totalActionCount as is
              processedActionCount: {
                $apply: oldCount => (resetCounter ? 0 : oldCount + processedQueueActions),
              },
              totalActionCount: { $apply: oldCount => (resetCounter ? 0 : oldCount) },
            },
          },
        });
      }
      return state;
    }

    case "DISCARD_SAVE_QUEUES": {
      return update(state, {
        save: {
          queue: { $set: { skeleton: [], volume: [] } },
          progressInfo: {
            processedActionCount: { $set: 0 },
            totalActionCount: { $set: 0 },
          },
        },
      });
    }

    case "SET_SAVE_BUSY": {
      return update(state, {
        save: { isBusyInfo: { [action.tracingType]: { $set: action.isBusy } } },
      });
    }

    case "SET_LAST_SAVE_TIMESTAMP": {
      return update(state, {
        save: { lastSaveTimestamp: { [action.tracingType]: { $set: action.timestamp } } },
      });
    }

    case "SET_VERSION_NUMBER": {
      return update(state, {
        tracing: { [action.tracingType]: { version: { $set: action.version } } },
      });
    }

    default:
      return state;
  }
}

export default SaveReducer;
