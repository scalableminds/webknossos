// @flow
import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState } from "oxalis/store";
import { updateKey2 } from "oxalis/model/helpers/deep_update";
import { getSegmentationLayers } from "oxalis/model/accessors/dataset_accessor";
import DiffableMap from "libs/diffable_map";

function createDictWithKeysAndValue<T>(
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
        localSegmentationData: createDictWithKeysAndValue(segmentationLayerNames, () => ({
          isosurfaces: {},
          availableMeshFiles: null,
          currentMeshFile: null,
          segments: new DiffableMap(),
          connectomeData: {
            availableConnectomeFiles: null,
            currentConnectomeFile: null,
            trees: {},
            tracingId: "",
            activeTreeId: null,
            activeNodeId: null,
          },
        })),
        temporaryConfiguration: {
          ...state.temporaryConfiguration,
          activeMappingByLayer: createDictWithKeysAndValue(segmentationLayerNames, () => ({
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
