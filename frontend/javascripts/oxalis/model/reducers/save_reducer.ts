import update from "immutability-helper";
import Date from "libs/date";
import _ from "lodash";
import { type TracingStats, getStats } from "oxalis/model/accessors/annotation_accessor";
import type { Action } from "oxalis/model/actions/actions";
import { getActionLog } from "oxalis/model/helpers/action_logger_middleware";
import { updateKey, updateKey2 } from "oxalis/model/helpers/deep_update";
import { MAXIMUM_ACTION_COUNT_PER_BATCH } from "oxalis/model/sagas/save_saga_constants";
import type { OxalisState, SaveState } from "oxalis/store";

// These update actions are not idempotent. Having them
// twice in the save queue causes a corruption of the current annotation.
// Therefore, we check this.
const NOT_IDEMPOTENT_ACTIONS = [
  "createEdge",
  "deleteEdge",
  "createTree",
  "deleteTree",
  "createNode",
  "deleteNode",
];

export function getTotalSaveQueueLength(queueObj: SaveState["queue"]) {
  return queueObj.length;
}

function SaveReducer(state: OxalisState, action: Action): OxalisState {
  switch (action.type) {
    case "PUSH_SAVE_QUEUE_TRANSACTION": {
      // Use `dispatchedAction` to better distinguish this variable from
      // update actions.
      const dispatchedAction = action;
      const { items, transactionId } = dispatchedAction;
      const stats: TracingStats = getStats(state.tracing);
      const { activeUser } = state;
      if (activeUser == null) {
        throw new Error("Tried to save something even though user is not logged in.");
      }

      const updateActionChunks = _.chunk(items, MAXIMUM_ACTION_COUNT_PER_BATCH);

      const transactionGroupCount = updateActionChunks.length;
      const actionLogInfo = JSON.stringify(getActionLog().slice(-10));
      const oldQueue = state.save.queue;
      const newQueue = oldQueue.concat(
        updateActionChunks.map((actions, transactionGroupIndex) => ({
          // Placeholder, the version number will be updated before sending to the server
          version: -1,
          transactionId,
          transactionGroupCount,
          transactionGroupIndex,
          timestamp: Date.now(),
          authorId: activeUser.id,
          actions,
          stats,
          // Redux Action Log context for debugging purposes.
          info: actionLogInfo,
        })),
      );

      // The following code checks that the update actions are not identical to the previously
      // added ones. We have received a bug report that showed corrupted data that should be
      // caught by the following check. If the bug appears again, we can investigate with more
      // details thanks to airbrake.
      if (
        oldQueue.length > 0 &&
        newQueue.length > 0 &&
        newQueue.at(-1)?.actions.some((action) => NOT_IDEMPOTENT_ACTIONS.includes(action.name)) &&
        _.isEqual(oldQueue.at(-1)?.actions, newQueue.at(-1)?.actions)
      ) {
        console.warn(
          "Redundant saving was detected.",
          oldQueue.at(-1)?.actions,
          newQueue.at(-1)?.actions,
        );
        throw new Error(
          "An internal error has occurred. To prevent data corruption, no saving was performed. Please reload the page and try the last action again.",
        );
      }

      return update(state, {
        save: {
          queue: {
            $set: newQueue,
          },
          progressInfo: {
            totalActionCount: {
              $apply: (count) => count + items.length,
            },
          },
        },
      });
    }

    case "SHIFT_SAVE_QUEUE": {
      const { count } = action;

      if (count > 0) {
        const queue = state.save.queue;

        const processedQueueActionCount = _.sumBy(
          queue.slice(0, count),
          (batch) => batch.actions.length,
        );

        const remainingQueue = queue.slice(count);
        const remainingQueueLength = getTotalSaveQueueLength(remainingQueue);
        const resetCounter = remainingQueueLength === 0;
        return update(state, {
          save: {
            queue: {
              $set: remainingQueue,
            },
            progressInfo: {
              // Reset progress counters if the queue is empty. Otherwise,
              // increase processedActionCount and leave totalActionCount as is
              processedActionCount: {
                $apply: (oldCount) => (resetCounter ? 0 : oldCount + processedQueueActionCount),
              },
              totalActionCount: {
                $apply: (oldCount) => (resetCounter ? 0 : oldCount),
              },
            },
          },
        });
      }

      return state;
    }

    case "DISCARD_SAVE_QUEUES": {
      return update(state, {
        save: {
          queue: {
            $set: [],
          },
          progressInfo: {
            processedActionCount: {
              $set: 0,
            },
            totalActionCount: {
              $set: 0,
            },
          },
        },
      });
    }

    case "SET_SAVE_BUSY": {
      return update(state, {
        save: {
          isBusy: {
            $set: action.isBusy,
          },
        },
      });
    }

    case "SET_LAST_SAVE_TIMESTAMP": {
      return updateKey2(state, "save", "lastSaveTimestamp", action.timestamp);
    }

    case "SET_VERSION_NUMBER": {
      return updateKey(state, "tracing", {
        version: action.version,
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
