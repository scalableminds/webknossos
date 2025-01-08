import update from "immutability-helper";
import Date from "libs/date";
import * as Utils from "libs/utils";
import _ from "lodash";
import { getStats } from "oxalis/model/accessors/annotation_accessor";
import { selectQueue } from "oxalis/model/accessors/save_accessor";
import type { Action } from "oxalis/model/actions/actions";
import type {
  SaveQueueType,
  SetLastSaveTimestampAction,
  SetVersionNumberAction,
} from "oxalis/model/actions/save_actions";
import { getActionLog } from "oxalis/model/helpers/action_logger_middleware";
import { updateKey2 } from "oxalis/model/helpers/deep_update";
import {
  updateEditableMapping,
  updateVolumeTracing,
} from "oxalis/model/reducers/volumetracing_reducer_helpers";
import { MAXIMUM_ACTION_COUNT_PER_BATCH } from "oxalis/model/sagas/save_saga_constants";
import type { OxalisState, SaveQueueEntry, SaveState } from "oxalis/store";

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

type TracingDict<V> = {
  skeleton: V;
  volumes: Record<string, V>;
  mappings: Record<string, V>;
};

function updateTracingDict<V>(
  action: { saveQueueType: SaveQueueType; tracingId: string },
  oldDict: TracingDict<V>,
  newValue: V,
): TracingDict<V> {
  if (action.saveQueueType === "skeleton") {
    return { ...oldDict, skeleton: newValue };
  } else if (action.saveQueueType === "volume") {
    return {
      ...oldDict,
      volumes: { ...oldDict.volumes, [action.tracingId]: newValue },
    };
  } else if (action.saveQueueType === "mapping") {
    return {
      ...oldDict,
      mappings: { ...oldDict.mappings, [action.tracingId]: newValue },
    };
  }

  return oldDict;
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
      const { items, transactionId } = action;
      if (items.length === 0) {
        return state;
      }
      // Only report tracing statistics, if a "real" update to the tracing happened
      const stats = _.some(action.items, (ua) => ua.name !== "updateTracing")
        ? getStats(state.tracing, action.saveQueueType, action.tracingId)
        : null;
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

      // The following code checks that the update actions are not identical to the previously
      // added ones. We have received a bug report that showed corrupted data that should be
      // caught by the following check. If the bug appears again, we can investigate with more
      // details thanks to airbrake.
      if (
        action.saveQueueType === "skeleton" &&
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

      const newQueueObj = updateTracingDict(action, state.save.queue, newQueue);
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

    case "SHIFT_SAVE_QUEUE": {
      const { count } = action;

      if (count > 0) {
        const queue = selectQueue(state, action.saveQueueType, action.tracingId);

        const processedQueueActionCount = _.sumBy(
          queue.slice(0, count),
          (batch) => batch.actions.length,
        );

        const remainingQueue = queue.slice(count);
        const newQueueObj = updateTracingDict(action, state.save.queue, remainingQueue);
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
      const newIsBusyInfo = updateTracingDict(action, state.save.isBusyInfo, action.isBusy);
      return update(state, {
        save: {
          isBusyInfo: {
            $set: newIsBusyInfo,
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
