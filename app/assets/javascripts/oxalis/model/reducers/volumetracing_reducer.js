// @flow

import update from "immutability-helper";
import type { OxalisState, VolumeTracingType } from "oxalis/store";
import type { VolumeTracingActionType } from "oxalis/model/actions/volumetracing_actions";
import type { ActionWithTimestamp } from "oxalis/model/helpers/timestamp_middleware";
import { getVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { setMode, setActiveCell, createCell } from "oxalis/model/reducers/volumetracing_reducer_helpers";
import Constants from "oxalis/constants";

function VolumeTracingReducer(state: OxalisState, action: ActionWithTimestamp<VolumeTracingActionType>): OxalisState {
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

      let volumeTracing: VolumeTracingType = {
        type: "volume",
        activeCellId: 0,
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

      volumeTracing = createCell(volumeTracing, contentData.activeCell)
        .map(([activeCell, newIdCount]) =>
          update(volumeTracing, {
            activeCellId: { $set: activeCell.id },
            cells: { [activeCell.id]: { $set: activeCell } },
            idCount: { $set: newIdCount },
          }))
        .getOrElse(volumeTracing);

      return update(state, { tracing: { $set: volumeTracing } });
    }
    default:
      // pass
  }
  console.log(action.type);
  return getVolumeTracing(state.tracing).map((volumeTracing) => {
    switch (action.type) {
      case "SET_MODE": {
        return setMode(state, volumeTracing, action.mode)
          .map(mode =>
            update(state, { tracing: { viewMode: { $set: mode } } }))
          .getOrElse(state);
      }

      case "TOGGLE_MODE": {
        const newMode = volumeTracing.viewMode === Constants.VOLUME_MODE_TRACE ?
            Constants.VOLUME_MODE_MOVE :
            Constants.VOLUME_MODE_TRACE;
        return setMode(state, volumeTracing, newMode)
          .map(mode =>
            update(state, { tracing: { viewMode: { $set: mode } } }))
          .getOrElse(state);
      }

      case "SET_ACTIVE_CELL": {
        return setActiveCell(volumeTracing, action.cellId)
          .map(([activeCell, idCount]) =>
            update(state, { tracing: {
              activeCellId: { $set: activeCell.id },
              cells: { [activeCell.id]: { $set: activeCell } },
              idCount: { $set: idCount },
            } }))
          .getOrElse(state);
      }

      case "CREATE_CELL": {
        return createCell(volumeTracing, action.cellId)
          .map(([newCell, idCount]) =>
            update(state, { tracing: {
              activeCellId: { $set: newCell.id },
              cells: { [newCell.id]: { $set: newCell } },
              idCount: { $set: idCount },
            } }))
          .getOrElse(state);
      }

      default:
        return state;
    }
  }).getOrElse(state);
}

export default VolumeTracingReducer;
