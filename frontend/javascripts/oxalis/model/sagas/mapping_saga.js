// @flow
import _ from "lodash";
import {
  type Saga,
  _all,
  _call,
  _takeEvery,
  _takeLatest,
  call,
  select,
  take,
  put,
  _actionChannel,
} from "oxalis/model/sagas/effect-generators";
import { message } from "antd";

import {
  setMappingAction,
  setMappingEnabledAction,
  type SetMappingAction,
} from "oxalis/model/actions/settings_actions";
import {
  fetchMapping,
  getMappingsForDatasetLayer,
  getAgglomeratesForDatasetLayer,
} from "admin/admin_rest_api";
import type { APIMapping } from "types/api_flow_types";
import { getLayerByName, getMappingInfo } from "oxalis/model/accessors/dataset_accessor";
import { type Mapping } from "oxalis/store";
import ErrorHandling from "libs/error_handling";
import { MAPPING_MESSAGE_KEY } from "oxalis/model/bucket_data_handling/mappings";
import api from "oxalis/api/internal_api";

type APIMappings = { [string]: APIMapping };

const isAgglomerate = mapping => {
  if (!mapping) {
    return false;
  }
  return mapping.mappingType === "HDF5";
};

export default function* watchActivatedMappings(): Saga<void> {
  const oldActiveMappingByLayer = {};
  // Buffer actions since they might be dispatched before WK_READY
  const setMappingActionChannel = yield _actionChannel("SET_MAPPING");
  const mappingChangeActionChannel = yield _actionChannel([
    "SET_MAPPING_ENABLED",
    "SET_HIDE_UNMAPPED_IDS",
  ]);
  yield* take("WK_READY");
  yield _takeLatest(setMappingActionChannel, maybeFetchMapping);
  yield _takeEvery(mappingChangeActionChannel, maybeReloadData, oldActiveMappingByLayer);
}

function* maybeReloadData(oldActiveMappingByLayer, action: SetMappingAction): Saga<void> {
  const { layerName, dataInvalidationPromise } = action;

  const oldMapping = getMappingInfo(oldActiveMappingByLayer, layerName);
  const activeMappingByLayer = yield* select(
    state => state.temporaryConfiguration.activeMappingByLayer,
  );
  const mapping = getMappingInfo(activeMappingByLayer, layerName);

  const isAgglomerateMappingInvolved = isAgglomerate(oldMapping) || isAgglomerate(mapping);
  const hasChanged = oldMapping !== mapping;
  const shouldReload = isAgglomerateMappingInvolved && hasChanged;
  if (shouldReload) {
    yield* call([api.data, api.data.reloadBuckets], layerName);
  }
  if (dataInvalidationPromise != null) dataInvalidationPromise();
  oldActiveMappingByLayer = activeMappingByLayer;
}

function* maybeFetchMapping(action: SetMappingAction): Saga<void> {
  const {
    layerName,
    mappingName,
    mappingType,
    mapping: existingMapping,
    showLoadingIndicator,
    dataInvalidationPromise,
  } = action;

  if (mappingName == null || existingMapping != null) {
    return;
  }

  if (showLoadingIndicator) {
    message.loading({ content: "Activating Mapping", key: MAPPING_MESSAGE_KEY });
  }

  const dataset = yield* select(state => state.dataset);
  const layerInfo = getLayerByName(dataset, layerName);

  const params = [
    dataset.dataStore.url,
    dataset,
    // If there is a fallbackLayer, request mappings for that instead of the tracing segmentation layer
    layerInfo.fallbackLayer != null ? layerInfo.fallbackLayer : layerInfo.name,
  ];
  const [jsonMappings, hdf5Mappings] = yield _all([
    _call(getMappingsForDatasetLayer, ...params),
    _call(getAgglomeratesForDatasetLayer, ...params),
  ]);

  const mappingsWithCorrectType = mappingType === "JSON" ? jsonMappings : hdf5Mappings;
  if (!mappingsWithCorrectType.includes(mappingName)) {
    // Mapping does not exist, set mappingName back to null
    const errorMessage = `Mapping with name ${mappingName} and type ${mappingType} does not exist. Available mappings are ${mappingsWithCorrectType.join(
      ",",
    )}.`;
    message.error({
      content: errorMessage,
      key: MAPPING_MESSAGE_KEY,
    });
    console.error(errorMessage);
    yield* put(setMappingAction(layerName, null, mappingType));
    return;
  }

  if (mappingType !== "JSON") {
    // Activate HDF5 mappings immediately. JSON mappings will be activated once they have been fetched.
    yield* put(setMappingEnabledAction(layerName, true, dataInvalidationPromise));
    message.destroy(MAPPING_MESSAGE_KEY);
    return;
  }

  const fetchedMappings = {};
  yield* call(fetchMappings, layerName, mappingName, fetchedMappings);
  const { hideUnmappedIds, colors: mappingColors } = fetchedMappings[mappingName];
  // If custom colors are specified for a mapping, assign the mapped ids specifically, so that the first equivalence
  // class will get the first color, and so on
  const assignNewIds = mappingColors != null && mappingColors.length > 0;
  const [mappingObject, mappingKeys] = yield* call(
    buildMappingObject,
    layerName,
    mappingName,
    fetchedMappings,
    assignNewIds,
  );
  const mappingProperties = { mapping: mappingObject, mappingKeys, mappingColors, hideUnmappedIds };

  yield* put(setMappingAction(layerName, mappingName, mappingType, mappingProperties));
}

function* fetchMappings(
  layerName: string,
  mappingName: string,
  fetchedMappings: APIMappings,
): Saga<void> {
  const dataset = yield* select(state => state.dataset);
  const layerInfo = getLayerByName(dataset, layerName);
  // If there is a fallbackLayer, request mappings for that instead of the tracing segmentation layer
  const mappingLayerName = layerInfo.fallbackLayer != null ? layerInfo.fallbackLayer : layerName;
  const mapping = yield* call(
    fetchMapping,
    dataset.dataStore.url,
    dataset,
    mappingLayerName,
    mappingName,
  );
  fetchedMappings[mappingName] = mapping;
  if (mapping.parent != null) {
    yield* call(fetchMappings, layerName, mapping.parent, fetchedMappings);
  }
}

function* getLargestSegmentId(layerName: string): Saga<number> {
  const dataset = yield* select(state => state.dataset);
  const segmentationLayer = getLayerByName(dataset, layerName);
  if (segmentationLayer.category !== "segmentation") {
    throw new Error("Mappings class must be instantiated with a segmentation layer.");
  }
  return segmentationLayer.largestSegmentId;
}

function* buildMappingObject(
  layerName: string,
  mappingName: string,
  fetchedMappings: APIMappings,
  assignNewIds: boolean,
): Saga<[Mapping, Array<number>]> {
  const mappingObject: Mapping = {};
  // Performance optimization: Object.keys(...) is slow for large objects
  // keeping track of the keys in a separate array is ~5x faster
  const mappingKeys = [];

  const maxId = (yield* call(getLargestSegmentId, layerName)) + 1;
  // Initialize to the next multiple of 256 that is larger than maxId
  let newMappedId = Math.ceil(maxId / 256) * 256;
  for (const currentMappingName of getMappingChain(mappingName, fetchedMappings)) {
    const mapping = fetchedMappings[currentMappingName];
    ErrorHandling.assertExists(mapping.classes, "Mappings must have been fetched at this point");

    if (mapping.classes) {
      for (const mappingClass of mapping.classes) {
        const minId = assignNewIds ? newMappedId : _.min(mappingClass);
        const mappedId = mappingObject[minId] || minId;
        for (const id of mappingClass) {
          mappingObject[id] = mappedId;
          mappingKeys.push(id);
        }
        newMappedId++;
      }
    }
  }
  mappingKeys.sort((a, b) => a - b);
  return [mappingObject, mappingKeys];
}

function getMappingChain(mappingName: string, fetchedMappings: APIMappings): Array<string> {
  const chain = [mappingName];
  const mapping = fetchedMappings[mappingName];
  const parentMappingName = mapping.parent;

  if (parentMappingName != null) {
    return chain.concat(getMappingChain(parentMappingName, fetchedMappings));
  }
  return chain;
}
