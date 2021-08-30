// @flow
import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState } from "oxalis/store";
import { updateKey2 } from "oxalis/model/helpers/deep_update";
import { getSegmentationLayers } from "oxalis/model/accessors/dataset_accessor";

function createDictsForKeys<T>(
  keys: Array<string>,
  makeDefaultValue: () => T,
): { [key: string]: T } {
  return Object.fromEntries(keys.map(key => [key, makeDefaultValue()]));
}

function DatasetReducer(state: OxalisState, action: Action): OxalisState {
  switch (action.type) {
    case "SET_DATASET": {
      const { dataset } = action;

      const segmentationLayerNames = getSegmentationLayers(dataset).map(layer => layer.name);

      return {
        ...state,
        dataset,
        isosurfacesByLayer: createDictsForKeys(segmentationLayerNames, () => ({})),
        availableMeshFilesByLayer: createDictsForKeys(segmentationLayerNames, () => null),
        currentMeshFileByLayer: createDictsForKeys(segmentationLayerNames, () => null),
        temporaryConfiguration: {
          ...state.temporaryConfiguration,
          activeMapping: createDictsForKeys(segmentationLayerNames, () => ({
            mappingName: null,
            mapping: null,
            mappingKeys: null,
            mappingColors: null,
            hideUnmappedIds: false,
            isMappingEnabled: false,
            mappingSize: 0,
            mappingType: "JSON",
          })),
        },
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
