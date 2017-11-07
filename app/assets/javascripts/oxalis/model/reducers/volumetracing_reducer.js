/**
 * volumetracing_reducer.js
 * @flow
 */
import update from "immutability-helper";
import type { OxalisState, VolumeTracingType } from "oxalis/store";
import type { VolumeTracingActionType } from "oxalis/model/actions/volumetracing_actions";
import { getVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import {
  setToolReducer,
  setActiveCellReducer,
  createCellReducer,
  updateDirectionReducer,
  addToLayerReducer,
  resetContourReducer,
  hideBrushReducer,
} from "oxalis/model/reducers/volumetracing_reducer_helpers";
import { convertServerBoundingBoxToFrontend } from "oxalis/model/reducers/reducer_helpers";
import { VolumeToolEnum } from "oxalis/constants";

function VolumeTracingReducer(state: OxalisState, action: VolumeTracingActionType): OxalisState {
  switch (action.type) {
    case "INITIALIZE_VOLUMETRACING": {
      const restrictions = Object.assign(
        {},
        action.annotation.restrictions,
        action.annotation.settings,
      );

      // As the frontend doesn't know all cells, we have to keep track of the highest id
      // and cannot compute it
      const maxCellId = action.tracing.largestSegmentId;
      const volumeTracing: VolumeTracingType = {
        annotationId: action.annotation.id,
        type: "volume",
        activeCellId: 0,
        lastCentroid: null,
        contourList: [],
        maxCellId,
        cells: {},
        restrictions,
        activeTool: VolumeToolEnum.MOVE,
        name: action.annotation.name,
        tracingType: action.annotation.typ,
        tracingId: action.annotation.content.id,
        version: action.tracing.version,
        boundingBox: convertServerBoundingBoxToFrontend(action.tracing.boundingBox),
        userBoundingBox: convertServerBoundingBoxToFrontend(action.tracing.userBoundingBox),
        isPublic: action.annotation.isPublic,
        tags: action.annotation.tags,
        description: action.annotation.description,
      };

      const newState = update(state, { tracing: { $set: volumeTracing } });
      return createCellReducer(newState, volumeTracing, action.tracing.activeSegmentId);
    }
    default:
    // pass
  }

  return getVolumeTracing(state.tracing)
    .map(volumeTracing => {
      switch (action.type) {
        case "SET_TOOL": {
          return setToolReducer(state, volumeTracing, action.tool);
        }

        case "CYCLE_TOOL": {
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

        case "FINISH_EDITING": {
          if (volumeTracing.contourList.length > 0) {
            return addToLayerReducer(state, volumeTracing, volumeTracing.contourList[0]);
          } else {
            return state;
          }
        }

        case "RESET_CONTOUR": {
          return resetContourReducer(state);
        }

        case "SET_BRUSH_POSITION": {
          return update(state, {
            temporaryConfiguration: { brushPosition: { $set: action.position } },
          });
        }

        case "HIDE_BRUSH": {
          return hideBrushReducer(state);
        }

        case "SET_BRUSH_SIZE": {
          const brushSize = Math.max(1, action.brushSize);
          return update(state, {
            temporaryConfiguration: { brushSize: { $set: brushSize } },
          });
        }

        default:
          return state;
      }
    })
    .getOrElse(state);
}

export default VolumeTracingReducer;
