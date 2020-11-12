/**
 * volumetracing_reducer.js
 * @flow
 */
import update from "immutability-helper";

import type { OxalisState, VolumeTracing } from "oxalis/store";
import { VolumeToolEnum, ContourModeEnum, OverwriteModeEnum } from "oxalis/constants";
import type { VolumeTracingAction } from "oxalis/model/actions/volumetracing_actions";
import {
  convertServerBoundingBoxToFrontend,
  convertUserBoundingBoxesFromServerToFrontend,
} from "oxalis/model/reducers/reducer_helpers";
import { getVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import {
  setToolReducer,
  setActiveCellReducer,
  createCellReducer,
  updateDirectionReducer,
  addToLayerReducer,
  resetContourReducer,
  setOverwriteModeModeReducer,
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
        activeCellId: 0,
        lastCentroid: null,
        contourTracingMode: ContourModeEnum.DRAW,
        overwriteMode: OverwriteModeEnum.OVERWRITE_ALL,
        contourList: [],
        maxCellId,
        cells: {},
        activeTool: VolumeToolEnum.MOVE,
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
        case "SET_TOOL": {
          if (!state.tracing.restrictions.allowUpdate) {
            return state;
          }
          return setToolReducer(state, volumeTracing, action.tool);
        }

        case "CYCLE_TOOL": {
          if (!state.tracing.restrictions.allowUpdate) {
            return state;
          }
          const tools = Object.keys(VolumeToolEnum);
          const currentToolIndex = tools.indexOf(volumeTracing.activeTool);
          const newTool = tools[(currentToolIndex + 1) % tools.length];

          return setToolReducer(hideBrushReducer(state), volumeTracing, newTool);
        }

        case "SET_ACTIVE_CELL": {
          return setActiveCellReducer(state, volumeTracing, action.cellId);
        }

        case "CREATE_CELL": {
          return createCellReducer(state, volumeTracing, action.cellId);
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

        case "SET_OVERWRITE_MODE": {
          return setOverwriteModeModeReducer(state, action.mode);
        }

        case "SET_MAX_CELL": {
          return setMaxCellReducer(state, volumeTracing, action.cellId);
        }

        default:
          return state;
      }
    })
    .getOrElse(state);
}

export default VolumeTracingReducer;
