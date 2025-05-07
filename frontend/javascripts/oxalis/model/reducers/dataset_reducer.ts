import DiffableMap from "libs/diffable_map";
import { deepIterate } from "libs/utils";
import { MappingStatusEnum } from "oxalis/constants";
import { getSegmentationLayers } from "oxalis/model/accessors/dataset_accessor";
import type { Action } from "oxalis/model/actions/actions";
import { updateKey2 } from "oxalis/model/helpers/deep_update";
import type { WebknossosState } from "oxalis/store";

function createDictWithKeysAndValue<T>(
  keys: Array<string>,
  makeDefaultValue: () => T,
): Record<string, T> {
  return Object.fromEntries(keys.map((key) => [key, makeDefaultValue()]));
}

function DatasetReducer(state: WebknossosState, action: Action): WebknossosState {
  switch (action.type) {
    case "SET_DATASET": {
      const { dataset } = action;
      const segmentationLayerNames = getSegmentationLayers(dataset).map((layer) => layer.name);
      return {
        ...state,
        dataset,
        localSegmentationData: createDictWithKeysAndValue(segmentationLayerNames, () => ({
          meshes: {},
          availableMeshFiles: null,
          currentMeshFile: null,
          segments: new DiffableMap(),
          connectomeData: {
            availableConnectomeFiles: null,
            currentConnectomeFile: null,
            pendingConnectomeFileName: null,
            activeAgglomerateIds: [],
            skeleton: null,
          },
          selectedIds: {
            segments: [],
            group: null,
          },
          hideUnregisteredSegments: false,
        })),
        temporaryConfiguration: {
          ...state.temporaryConfiguration,
          activeMappingByLayer: createDictWithKeysAndValue(segmentationLayerNames, () => ({
            mappingName: null,
            mapping: null,
            mappingColors: null,
            hideUnmappedIds: false,
            mappingStatus: MappingStatusEnum.DISABLED,
            mappingType: "JSON",
          })),
        },
      };
    }

    case "SET_LAYER_MAPPINGS": {
      const { layerName, mappingNames, agglomerateNames } = action;
      const newLayers = state.dataset.dataSource.dataLayers.map((layer) => {
        if (layer.category === "segmentation" && layer.name === layerName) {
          return { ...layer, mappings: mappingNames, agglomerates: agglomerateNames };
        } else {
          return layer;
        }
      });
      return updateKey2(state, "dataset", "dataSource", {
        dataLayers: newLayers,
      });
    }

    case "SET_LAYER_HAS_SEGMENT_INDEX": {
      const { layerName, hasSegmentIndex } = action;
      const newLayers = state.dataset.dataSource.dataLayers.map((layer) => {
        if (layer.name === layerName) {
          return {
            ...layer,
            hasSegmentIndex,
          };
        } else {
          return layer;
        }
      });

      return updateKey2(state, "dataset", "dataSource", {
        dataLayers: newLayers,
      });
    }

    case "SET_LAYER_TRANSFORMS": {
      const { layerName, coordinateTransformations } = action;

      let hasNaN = false;
      deepIterate(coordinateTransformations, (el: any) => {
        if (Number.isNaN(el)) hasNaN = true;
      });

      if (hasNaN) {
        console.error(
          "Did not update layer transforms, because it contained NaN values.",
          coordinateTransformations,
        );
        return state;
      }
      const newLayers = state.dataset.dataSource.dataLayers.map((layer) => {
        if (layer.name === layerName) {
          return {
            ...layer,
            coordinateTransformations,
          };
        } else {
          return layer;
        }
      });

      return updateKey2(state, "dataset", "dataSource", {
        dataLayers: newLayers,
      });
    }

    default: // pass;
  }

  return state;
}

export default DatasetReducer;
