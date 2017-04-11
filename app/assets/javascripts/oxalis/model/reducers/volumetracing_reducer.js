/**
 * volumetracing_reducer.js
 * @flow
 */
import update from "immutability-helper";
import type { OxalisState, VolumeTracingType } from "oxalis/store";
import type { VolumeTracingActionType } from "oxalis/model/actions/volumetracing_actions";
import { getVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { setModeReducer, setActiveCellReducer, createCellReducer, updateDirectionReducer, addToLayerReducer, resetContourReducer } from "oxalis/model/reducers/volumetracing_reducer_helpers";
import Constants from "oxalis/constants";

function VolumeTracingReducer(state: OxalisState, action: VolumeTracingActionType): OxalisState {
  switch (action.type) {
    case "INITIALIZE_VOLUMETRACING": {
      const restrictions = Object.assign({}, action.tracing.restrictions, action.tracing.content.settings);
      const { contentData } = action.tracing.content;

      // As the frontend doesn't know all cells, we have to keep track of the highest id
      // and cannot compute it
      let idCount = 1;
      if (contentData.nextCell != null) {
        idCount = contentData.nextCell;
      }

      const volumeTracing: VolumeTracingType = {
        type: "volume",
        activeCellId: 0,
        lastCentroid: null,
        contourList: [],
        idCount,
        cells: {},
        cubes: [],
        controlMode: "Trace",
        restrictions,
        viewMode: Constants.VOLUME_MODE_MOVE,
        name: action.tracing.dataSetName,
        tracingType: action.tracing.typ,
        tracingId: action.tracing.id,
        version: action.tracing.version,
      };

      const newState = update(state, { tracing: { $set: volumeTracing } });
      return createCellReducer(newState, volumeTracing, contentData.activeCell);
    }
    default:
      // pass
  }

  return getVolumeTracing(state.tracing).map((volumeTracing) => {
    switch (action.type) {
      case "SET_MODE": {
        return setModeReducer(state, volumeTracing, action.mode);
      }

      case "TOGGLE_MODE": {
        const newMode = volumeTracing.viewMode === Constants.VOLUME_MODE_TRACE ?
            Constants.VOLUME_MODE_MOVE :
            Constants.VOLUME_MODE_TRACE;
        return setModeReducer(state, volumeTracing, newMode);
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

      default:
        return state;
    }
  }).getOrElse(state);
}

export default VolumeTracingReducer;
