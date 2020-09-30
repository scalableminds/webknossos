/**
 * save_reducer.js
 * @flow
 */

import _ from "lodash";
import update from "immutability-helper";

import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState } from "oxalis/store";
import { getActionLog } from "oxalis/model/helpers/action_logger_middleware";
import { getStats } from "oxalis/model/accessors/skeletontracing_accessor";
import { maximumActionCountPerBatch } from "oxalis/model/sagas/save_saga_constants";
import Date from "libs/date";
import * as Utils from "libs/utils";
import { updateKey2 } from "oxalis/model/helpers/deep_update";

function SaveReducer(state: OxalisState, action: Action): OxalisState {
  switch (action.type) {
    case "PUSH_SAVE_QUEUE_TRANSACTION": {
      // Only report tracing statistics, if a "real" update to the tracing happened
      const stats = _.some(action.items, ua => ua.name !== "updateTracing")
        ? Utils.toNullable(getStats(state.tracing))
        : null;
      const { items, transactionId } = action;

      if (items.length > 0) {
        const updateActionChunks = _.chunk(items, maximumActionCountPerBatch);
        const transactionGroupCount = updateActionChunks.length;

        const oldQueue = state.save.queue[action.tracingType];
        const newQueue = oldQueue.concat(
          updateActionChunks.map((actions, transactionGroupIndex) => ({
            // Placeholder, the version number will be updated before sending to the server
            version: -1,
            transactionId,
            transactionGroupCount,
            transactionGroupIndex,
            timestamp: Date.now(),
            actions,
            stats,
            // TODO: Redux Action Log context for debugging purposes. Remove this again if it is no longer needed.
            info: JSON.stringify(getActionLog().slice(-50)),
          })),
        );
        return update(state, {
          save: {
            queue: {
              // $FlowFixMe See https://github.com/facebook/flow/issues/8299
              [action.tracingType]: {
                $set: newQueue,
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
          state.save.queue[action.tracingType === "skeleton" ? "volume" : "skeleton"];
        const resetCounter = remainingQueue.length === 0 && otherQueue.length === 0;
        return update(state, {
          save: {
            // $FlowFixMe See https://github.com/facebook/flow/issues/8299
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
        // $FlowFixMe See https://github.com/facebook/flow/issues/8299
        save: { isBusyInfo: { [action.tracingType]: { $set: action.isBusy } } },
      });
    }

    case "SET_LAST_SAVE_TIMESTAMP": {
      return update(state, {
        // $FlowFixMe See https://github.com/facebook/flow/issues/8299
        save: { lastSaveTimestamp: { [action.tracingType]: { $set: action.timestamp } } },
      });
    }

    case "SET_VERSION_NUMBER": {
      return update(state, {
        // $FlowFixMe See https://github.com/facebook/flow/issues/8299
        tracing: { [action.tracingType]: { version: { $set: action.version } } },
      });
    }

    case "DISABLE_SAVING": {
      if (state.task != null) {
        // Don't disable saving in a task, even when this action was dispatched somehow.
        return state;
      }
      return updateKey2(state, "tracing", "restrictions", {
        allowSave: false,
      });
    }

    default:
      return state;
  }
}

export default SaveReducer;
