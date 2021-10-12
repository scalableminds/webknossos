/**
 * volumetracing_reducer.js
 * @flow
 */
import update from "immutability-helper";

import type { OxalisState, VolumeTracing } from "oxalis/store";
import { ContourModeEnum } from "oxalis/constants";
import type { VolumeTracingAction } from "oxalis/model/actions/volumetracing_actions";
import {
  convertServerBoundingBoxToFrontend,
  convertUserBoundingBoxesFromServerToFrontend,
} from "oxalis/model/reducers/reducer_helpers";
import { getVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import {
  setActiveCellReducer,
  createCellReducer,
  updateDirectionReducer,
  addToLayerReducer,
  resetContourReducer,
  hideBrushReducer,
  setContourTracingModeReducer,
  setMaxCellReducer,
} from "oxalis/model/reducers/volumetracing_reducer_helpers";

function VolumeTracingReducer(state: OxalisState, action: VolumeTracingAction): OxalisState {
  switch (action.type) {
    case "INITIALIZE_VOLUMETRACING": {
      // As the frontend doesn't know all cells, we have to keep track of the highest id
      // and cannot compute it
      const maxCellId = action.tracing.largestSegmentId;
      const userBoundingBoxes = convertUserBoundingBoxesFromServerToFrontend(
        action.tracing.userBoundingBoxes,
      );
      const volumeTracing: VolumeTracing = {
        createdTimestamp: action.tracing.createdTimestamp,
        type: "volume",
        segments: new Map(),
        activeCellId: 0,
        lastCentroid: null,
        contourTracingMode: ContourModeEnum.DRAW,
        contourList: [],
        maxCellId,
        cells: {},
        tracingId: action.tracing.id,
        version: action.tracing.version,
        boundingBox: convertServerBoundingBoxToFrontend(action.tracing.boundingBox),
        fallbackLayer: action.tracing.fallbackLayer,
        userBoundingBoxes,
      };

      const newState = update(state, { tracing: { volume: { $set: volumeTracing } } });
      return createCellReducer(newState, volumeTracing, action.tracing.activeSegmentId);
    }
    default:
    // pass
  }

  return getVolumeTracing(state.tracing)
    .map(volumeTracing => {
      switch (action.type) {
        case "SET_ACTIVE_CELL": {
          return setActiveCellReducer(state, volumeTracing, action.cellId);
        }

        case "CREATE_CELL": {
          return createCellReducer(state, volumeTracing);
        }

        case "UPDATE_DIRECTION": {
          return updateDirectionReducer(state, volumeTracing, action.centroid);
        }

        case "ADD_TO_LAYER": {
          return addToLayerReducer(state, volumeTracing, action.position);
        }

        case "RESET_CONTOUR": {
          return resetContourReducer(state);
        }

        case "HIDE_BRUSH": {
          return hideBrushReducer(state);
        }

        case "SET_CONTOUR_TRACING_MODE": {
          return setContourTracingModeReducer(state, action.mode);
        }

        case "SET_MAX_CELL": {
          return setMaxCellReducer(state, action.cellId);
        }

        case "FINISH_ANNOTATION_STROKE": {
          // Possibly update the maxCellId after volume annotation
          const { activeCellId, maxCellId } = volumeTracing;
          return setMaxCellReducer(state, Math.max(activeCellId, maxCellId));
        }

        case "SET_SEGMENTS": {
          const { segments } = action;
          return update(state, { tracing: { volume: { segments: { $set: segments } } } });
        }

        case "SET_SOME_POSITION_OF_SEGMENT": {
          const { segmentId, somePosition } = action;
          const { segments } = volumeTracing;
          if (!segments.has(`${segmentId}`)) {
            const newSegment = {
              id: segmentId,
              somePosition,
              name: `Segment ${segmentId}`,
            };
            return update(state, {
              tracing: {
                volume: {
                  // Immutability helper seems to automatically transform number keys to strings. Thus we also need a string here
                  // TODO: Maybe find a way to save this data more efficient.
                  // Always transforming the id to a string does not sound very fast and the conversion needs to be done at multiple points in the code.
                  segments: { $add: [[`${segmentId}`, newSegment]] },
                },
              },
            });
          }
          return update(state, {
            tracing: {
              volume: { segments: { [`${segmentId}`]: { somePosition: { $set: somePosition } } } },
            },
          });
        }

        default:
          return state;
      }
    })
    .getOrElse(state);
}

export default VolumeTracingReducer;
