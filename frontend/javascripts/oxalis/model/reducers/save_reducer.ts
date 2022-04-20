import _ from "lodash";
import update from "immutability-helper";
import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState, SaveState, SaveQueueEntry } from "oxalis/store";
import type {
  PushSaveQueueTransaction,
  SetVersionNumberAction,
  ShiftSaveQueueAction,
} from "oxalis/model/actions/save_actions";
import { getActionLog } from "oxalis/model/helpers/action_logger_middleware";
import { getStats } from "oxalis/model/accessors/skeletontracing_accessor";
import { maximumActionCountPerBatch } from "oxalis/model/sagas/save_saga_constants";
import { selectQueue } from "oxalis/model/accessors/save_accessor";
import { updateKey2 } from "oxalis/model/helpers/deep_update";
import { updateVolumeTracing } from "oxalis/model/reducers/volumetracing_reducer_helpers";
import Date from "libs/date";
import * as Utils from "libs/utils";

function updateQueueObj(
  action: PushSaveQueueTransaction | ShiftSaveQueueAction,
  oldQueueObj: SaveState["queue"],
  newQueue: any,
): SaveState["queue"] {
  if (action.tracingType === "skeleton") {
    return { ...oldQueueObj, skeleton: newQueue };
  }

  return { ...oldQueueObj, volumes: { ...oldQueueObj.volumes, [action.tracingId]: newQueue } };
}

export function getTotalSaveQueueLength(queueObj: SaveState["queue"]) {
  return (
    queueObj.skeleton.length +
    _.sum(Utils.values(queueObj.volumes).map((volumeQueue: SaveQueueEntry[]) => volumeQueue.length))
  );
}

function updateVersion(state: OxalisState, action: SetVersionNumberAction) {
  if (action.tracingType === "skeleton" && state.tracing.skeleton != null) {
    return updateKey2(state, "tracing", "skeleton", {
      version: action.version,
    });
  }

  return updateVolumeTracing(state, action.tracingId, {
    version: action.version,
  });
}

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'state' implicitly has an 'any' type.
function updateLastSaveTimestamp(state, action) {
  if (action.tracingType === "skeleton") {
    return updateKey2(state, "save", "lastSaveTimestamp", {
      skeleton: action.timestamp,
    });
  }

  const newVolumesDict = {
    ...state.save.lastSaveTimestamp.volumes,
    [action.tracingId]: action.timestamp,
  };
  return updateKey2(state, "save", "lastSaveTimestamp", {
    volumes: newVolumesDict,
  });
}

function SaveReducer(state: OxalisState, action: Action): OxalisState {
  switch (action.type) {
    case "INITIALIZE_VOLUMETRACING": {
      // Set up empty save queue array for volume tracing
      const newVolumesQueue = { ...state.save.queue.volumes, [action.tracing.id]: [] };
      return updateKey2(state, "save", "queue", {
        volumes: newVolumesQueue,
      });
    }

    case "PUSH_SAVE_QUEUE_TRANSACTION": {
      // Only report tracing statistics, if a "real" update to the tracing happened
      const stats = _.some(action.items, (ua) => ua.name !== "updateTracing")
        ? Utils.toNullable(getStats(state.tracing))
        : null;
      const { items, transactionId } = action;

      if (items.length > 0) {
        const updateActionChunks = _.chunk(items, maximumActionCountPerBatch);

        const transactionGroupCount = updateActionChunks.length;
        const actionLogInfo = JSON.stringify(getActionLog().slice(-10));
        const oldQueue = selectQueue(state, action.tracingType, action.tracingId);
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
            // Redux Action Log context for debugging purposes.
            info: actionLogInfo,
          })),
        );
        const newQueueObj = updateQueueObj(action, state.save.queue, newQueue);
        return update(state, {
          save: {
            queue: {
              $set: newQueueObj,
            },
            progressInfo: {
              totalActionCount: {
                $apply: (count) => count + items.length,
              },
            },
          },
        });
      }

      return state;
    }

    case "SHIFT_SAVE_QUEUE": {
      const { count } = action;

      if (count > 0) {
        const queue = selectQueue(state, action.tracingType, action.tracingId);

        const processedQueueActionCount = _.sumBy(
          queue.slice(0, count),
          (batch) => batch.actions.length,
        );

        const remainingQueue = queue.slice(count);
        const newQueueObj = updateQueueObj(action, state.save.queue, remainingQueue);
        const remainingQueueLength = getTotalSaveQueueLength(newQueueObj);
        const resetCounter = remainingQueueLength === 0;
        return update(state, {
          save: {
            queue: {
              $set: newQueueObj,
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
            $set: {
              skeleton: [],
              volumes: _.mapValues(state.save.queue.volumes, () => []),
            },
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
          isBusyInfo: {
            [action.tracingType]: {
              $set: action.isBusy,
            },
          },
        },
      });
    }

    case "SET_LAST_SAVE_TIMESTAMP": {
      return updateLastSaveTimestamp(state, action);
    }

    case "SET_VERSION_NUMBER": {
      return updateVersion(state, action);
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
