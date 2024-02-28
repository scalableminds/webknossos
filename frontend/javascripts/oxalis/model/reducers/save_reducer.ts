import update from "immutability-helper";
import Date from "libs/date";
import * as Utils from "libs/utils";
import _ from "lodash";
import { getStats } from "oxalis/model/accessors/annotation_accessor";
import { selectQueue } from "oxalis/model/accessors/save_accessor";
import type { Action } from "oxalis/model/actions/actions";
import type {
  PushSaveQueueTransaction,
  SetLastSaveTimestampAction,
  SetVersionNumberAction,
  ShiftSaveQueueAction,
} from "oxalis/model/actions/save_actions";
import { getActionLog } from "oxalis/model/helpers/action_logger_middleware";
import { updateKey2 } from "oxalis/model/helpers/deep_update";
import {
  updateEditableMapping,
  updateVolumeTracing,
} from "oxalis/model/reducers/volumetracing_reducer_helpers";
import { MAXIMUM_ACTION_COUNT_PER_BATCH } from "oxalis/model/sagas/save_saga_constants";
import type { OxalisState, SaveQueueEntry, SaveState } from "oxalis/store";

function updateQueueObj(
  action: PushSaveQueueTransaction | ShiftSaveQueueAction,
  oldQueueObj: SaveState["queue"],
  newQueue: any,
): SaveState["queue"] {
  if (action.saveQueueType === "skeleton") {
    return { ...oldQueueObj, skeleton: newQueue };
  } else if (action.saveQueueType === "volume") {
    return { ...oldQueueObj, volumes: { ...oldQueueObj.volumes, [action.tracingId]: newQueue } };
  } else if (action.saveQueueType === "mapping") {
    return { ...oldQueueObj, mappings: { ...oldQueueObj.mappings, [action.tracingId]: newQueue } };
  }

  return oldQueueObj;
}

export function getTotalSaveQueueLength(queueObj: SaveState["queue"]) {
  return (
    queueObj.skeleton.length +
    _.sum(
      Utils.values(queueObj.volumes).map((volumeQueue: SaveQueueEntry[]) => volumeQueue.length),
    ) +
    _.sum(
      Utils.values(queueObj.mappings).map((mappingQueue: SaveQueueEntry[]) => mappingQueue.length),
    )
  );
}

function updateVersion(state: OxalisState, action: SetVersionNumberAction) {
  if (action.saveQueueType === "skeleton" && state.tracing.skeleton != null) {
    return updateKey2(state, "tracing", "skeleton", {
      version: action.version,
    });
  } else if (action.saveQueueType === "volume") {
    return updateVolumeTracing(state, action.tracingId, {
      version: action.version,
    });
  } else if (action.saveQueueType === "mapping") {
    return updateEditableMapping(state, action.tracingId, {
      version: action.version,
    });
  }

  return state;
}

function updateLastSaveTimestamp(state: OxalisState, action: SetLastSaveTimestampAction) {
  if (action.saveQueueType === "skeleton") {
    return updateKey2(state, "save", "lastSaveTimestamp", {
      skeleton: action.timestamp,
    });
  } else if (action.saveQueueType === "volume") {
    const newVolumesDict = {
      ...state.save.lastSaveTimestamp.volumes,
      [action.tracingId]: action.timestamp,
    };
    return updateKey2(state, "save", "lastSaveTimestamp", {
      volumes: newVolumesDict,
    });
  } else if (action.saveQueueType === "mapping") {
    const newMappingsDict = {
      ...state.save.lastSaveTimestamp.mappings,
      [action.tracingId]: action.timestamp,
    };
    return updateKey2(state, "save", "lastSaveTimestamp", {
      mappings: newMappingsDict,
    });
  }

  return state;
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

    case "INITIALIZE_EDITABLE_MAPPING": {
      // Set up empty save queue array for editable mapping
      const newMappingsQueue = { ...state.save.queue.mappings, [action.mapping.tracingId]: [] };
      return updateKey2(state, "save", "queue", {
        mappings: newMappingsQueue,
      });
    }

    case "PUSH_SAVE_QUEUE_TRANSACTION": {
      // Only report tracing statistics, if a "real" update to the tracing happened
      const stats = _.some(action.items, (ua) => ua.name !== "updateTracing")
        ? getStats(state.tracing, action.saveQueueType, action.tracingId)
        : null;
      const { items, transactionId } = action;

      if (items.length > 0) {
        const { activeUser } = state;
        if (activeUser == null) {
          throw new Error("Tried to save something even though user is not logged in.");
        }

        const updateActionChunks = _.chunk(
          items,
          MAXIMUM_ACTION_COUNT_PER_BATCH[action.saveQueueType],
        );

        const transactionGroupCount = updateActionChunks.length;
        const actionLogInfo = JSON.stringify(getActionLog().slice(-10));
        const oldQueue = selectQueue(state, action.saveQueueType, action.tracingId);
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
        const queue = selectQueue(state, action.saveQueueType, action.tracingId);

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
              mappings: _.mapValues(state.save.queue.mappings, () => []),
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
            [action.saveQueueType]: {
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
