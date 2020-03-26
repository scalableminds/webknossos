// @flow
import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState } from "oxalis/store";
import { updateKey2 } from "oxalis/model/helpers/deep_update";

function DatasetReducer(state: OxalisState, action: Action): OxalisState {
  switch (action.type) {
    case "SET_DATASET": {
      const { dataset } = action;
      return {
        ...state,
        dataset,
      };
    }
    case "SET_LAYER_MAPPINGS": {
      const { layerName, mappingNames, agglomerateNames } = action;
      const newLayers = state.dataset.dataSource.dataLayers.map(layer => {
        if (layer.category === "segmentation" && layer.name === layerName) {
          return { ...layer, mappings: mappingNames, agglomerates: agglomerateNames };
        } else {
          return layer;
        }
      });
      return updateKey2(state, "dataset", "dataSource", { dataLayers: newLayers });
    }
    default:
    // pass;
  }

  return state;
}

export default DatasetReducer;
