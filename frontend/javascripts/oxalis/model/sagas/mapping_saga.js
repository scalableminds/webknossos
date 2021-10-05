// @flow
import _ from "lodash";
import {
  type Saga,
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
import { fetchMapping } from "admin/admin_rest_api";
import type { APIMapping } from "types/api_flow_types";
import { getLayerByName } from "oxalis/model/accessors/dataset_accessor";
import { type Mapping } from "oxalis/store";
import ErrorHandling from "libs/error_handling";
import { MAPPING_MESSAGE_KEY } from "oxalis/model/bucket_data_handling/mappings";

type APIMappings = { [string]: APIMapping };

export default function* watchActivatedMappings(): Saga<void> {
  // Buffer actions since they might be dispatched before WK_READY
  const actionChannel = yield _actionChannel("SET_MAPPING");
  yield* take("WK_READY");
  yield _takeLatest(actionChannel, maybeFetchMapping);
}

function* maybeFetchMapping(action: SetMappingAction): Saga<void> {
  const {
    layerName,
    mappingName,
    mappingType,
    mapping: existingMapping,
    showLoadingIndicator,
  } = action;

  if (mappingName == null || existingMapping != null) {
    return;
  }

  if (showLoadingIndicator) {
    message.loading({ content: "Activating Mapping", key: MAPPING_MESSAGE_KEY });
  }

  if (mappingType !== "JSON") {
    // Activate HDF5 mappings immediately. JSON mappings will be activated once they have been fetched.
    yield* put(setMappingEnabledAction(layerName, true));
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
