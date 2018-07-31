/**
 * save_reducer.js
 * @flow
 */

import _ from "lodash";
import update from "immutability-helper";
import Date from "libs/date";
import Utils from "libs/utils";
import { getStats } from "oxalis/model/accessors/skeletontracing_accessor";
import type { OxalisState } from "oxalis/store";
import type { ActionType } from "oxalis/model/actions/actions";

function SaveReducer(state: OxalisState, action: ActionType): OxalisState {
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
          state.save.queue.slice(0, count),
          batch => batch.actions.length,
        );
        const remainingQueue = state.save.queue[action.tracingType].slice(count);
        const resetCounter = remainingQueue.length === 0;
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
        save: { isBusy: { $set: action.isBusy } },
      });
    }

    case "SET_LAST_SAVE_TIMESTAMP": {
      return update(state, {
        save: { lastSaveTimestamp: { $set: action.timestamp } },
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
