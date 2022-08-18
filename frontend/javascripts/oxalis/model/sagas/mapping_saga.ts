import _ from "lodash";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { all, call, takeEvery, takeLatest, take, put, fork, actionChannel } from "typed-redux-saga";
import { select } from "oxalis/model/sagas/effect-generators";
import { message } from "antd";
import type {
  SetMappingAction,
  SetMappingEnabledAction,
} from "oxalis/model/actions/settings_actions";
import { setMappingAction, setMappingEnabledAction } from "oxalis/model/actions/settings_actions";
import {
  fetchMapping,
  getMappingsForDatasetLayer,
  getAgglomeratesForDatasetLayer,
} from "admin/admin_rest_api";
import type { APIMapping } from "types/api_flow_types";
import { setLayerMappingsAction } from "oxalis/model/actions/dataset_actions";
import { getLayerByName, getMappingInfo } from "oxalis/model/accessors/dataset_accessor";
import type { ActiveMappingInfo, Mapping } from "oxalis/store";
import ErrorHandling from "libs/error_handling";
import { MAPPING_MESSAGE_KEY } from "oxalis/model/bucket_data_handling/mappings";
import api from "oxalis/api/internal_api";
import { MappingStatusEnum } from "oxalis/constants";
import { isMappingActivationAllowed } from "oxalis/model/accessors/volumetracing_accessor";
import Toast from "libs/toast";
type APIMappings = Record<string, APIMapping>;

const isAgglomerate = (mapping: ActiveMappingInfo) => {
  if (!mapping) {
    return false;
  }

  return mapping.mappingType === "HDF5";
};

export default function* watchActivatedMappings(): Saga<void> {
  const oldActiveMappingByLayer = yield* select(
    (state) => state.temporaryConfiguration.activeMappingByLayer,
  );
  // Buffer actions since they might be dispatched before WK_READY
  const setMappingActionChannel = yield* actionChannel("SET_MAPPING");
  const mappingChangeActionChannel = yield* actionChannel(["SET_MAPPING_ENABLED"]);
  yield* take("WK_READY");
  yield* takeLatest(setMappingActionChannel, maybeFetchMapping, oldActiveMappingByLayer);
  yield* takeEvery(mappingChangeActionChannel, maybeReloadData, oldActiveMappingByLayer);
}

function* maybeReloadData(
  oldActiveMappingByLayer: Record<string, ActiveMappingInfo>,
  action: SetMappingAction | SetMappingEnabledAction,
): Saga<void> {
  const { layerName } = action;
  const oldMapping = getMappingInfo(oldActiveMappingByLayer, layerName);
  const activeMappingByLayer = yield* select(
    (state) => state.temporaryConfiguration.activeMappingByLayer,
  );
  const mapping = getMappingInfo(activeMappingByLayer, layerName);
  const isAgglomerateMappingInvolved = isAgglomerate(oldMapping) || isAgglomerate(mapping);
  const hasChanged = oldMapping !== mapping;
  const shouldReload = isAgglomerateMappingInvolved && hasChanged;

  if (shouldReload) {
    yield* call([api.data, api.data.reloadBuckets], layerName);
  }

  // If an agglomerate mapping is being activated, the data reload is the last step
  // of the mapping activation. For JSON mappings, the last step of the mapping activation
  // is the texture creation in mappings.js
  if (isAgglomerate(mapping) && mapping.mappingStatus === MappingStatusEnum.ACTIVATING) {
    yield* put(setMappingEnabledAction(layerName, true));
    message.destroy(MAPPING_MESSAGE_KEY);
  }

  oldActiveMappingByLayer = activeMappingByLayer;
}

function* maybeFetchMapping(
  oldActiveMappingByLayer: Record<string, ActiveMappingInfo>,
  action: SetMappingAction,
): Saga<void> {
  const {
    layerName,
    mappingName,
    mappingType,
    mapping: existingMapping,
    showLoadingIndicator,
  } = action;

  // Editable mappings cannot be disabled or switched for now
  const isEditableMappingActivationAllowed = yield* select((state) =>
    isMappingActivationAllowed(state, mappingName, layerName),
  );
  if (!isEditableMappingActivationAllowed) return;

  if (mappingName == null || existingMapping != null) return;

  if (showLoadingIndicator) {
    message.loading({
      content: "Activating Mapping",
      key: MAPPING_MESSAGE_KEY,
    });
  }

  const dataset = yield* select((state) => state.dataset);
  const layerInfo = getLayerByName(dataset, layerName);
  const params = [
    dataset.dataStore.url,
    dataset, // If there is a fallbackLayer, request mappings for that instead of the tracing segmentation layer
    "fallbackLayer" in layerInfo && layerInfo.fallbackLayer != null
      ? layerInfo.fallbackLayer
      : layerInfo.name,
  ];
  const [jsonMappings, serverHdf5Mappings] = yield* all([
    // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
    call(getMappingsForDatasetLayer, ...params),
    // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
    call(getAgglomeratesForDatasetLayer, ...params),
  ]);
  // Make sure the available mappings are persisted in the store if they are not already
  const areServerHdf5MappingsInStore =
    "agglomerates" in layerInfo && layerInfo.agglomerates != null;
  if (!areServerHdf5MappingsInStore) {
    yield* put(setLayerMappingsAction(layerName, jsonMappings, serverHdf5Mappings));
  }
  const editableMappings = yield* select((state) =>
    state.tracing.volumes
      .filter((volumeTracing) => volumeTracing.mappingIsEditable)
      .map((volumeTracing) => volumeTracing.mappingName),
  );
  const hdf5Mappings = [...serverHdf5Mappings, ...editableMappings];
  const mappingsWithCorrectType = mappingType === "JSON" ? jsonMappings : hdf5Mappings;

  if (!mappingsWithCorrectType.includes(mappingName)) {
    // Mapping does not exist, set mappingName back to null
    const availableMappings = mappingsWithCorrectType.join(",");
    const availableMappingsString =
      availableMappings.length > 0
        ? `Available ${mappingType} mappings are ${availableMappings}`
        : `There are no available ${mappingType} mappings`;
    const errorMessage = `Mapping with name ${mappingName} and type ${mappingType} does not exist. ${availableMappingsString}.`;
    message.error({
      content: errorMessage,
      key: MAPPING_MESSAGE_KEY,
      duration: 10,
    });
    console.error(errorMessage);
    yield* put(setMappingAction(layerName, null, mappingType));
    return;
  }

  // Call maybeReloadData only after it was checked whether the activated mapping is valid, otherwise there would
  // be a race between the maybeReloadData and maybeFetchMapping sagas
  yield* fork(maybeReloadData, oldActiveMappingByLayer, action);

  if (mappingType !== "JSON") {
    // Only JSON mappings need to be fetched, HDF5 mappings are applied by the server
    return;
  }

  const fetchedMappings: APIMappings = {};
  try {
    yield* call(fetchMappings, layerName, mappingName, fetchedMappings);
  } catch (exception) {
    yield* call(
      [Toast, Toast.error],
      "The requested mapping could not be loaded.",
      { sticky: true },
      `${exception}`,
    );
    console.error(exception);
    yield* put(setMappingAction(layerName, null, mappingType));
    return;
  }
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
  const mappingProperties = {
    mapping: mappingObject,
    mappingKeys,
    mappingColors,
    hideUnmappedIds,
  };

  if (layerInfo.elementClass === "uint64") {
    yield* call(
      [Toast, Toast.warning],
      "The activated mapping will only be valid for the lower 32-bits of the active 64-bit segmentation.",
      { sticky: true },
    );
  }

  yield* put(setMappingAction(layerName, mappingName, mappingType, mappingProperties));
}

function* fetchMappings(
  layerName: string,
  mappingName: string,
  fetchedMappings: APIMappings,
): Saga<void> {
  const dataset = yield* select((state) => state.dataset);
  const layerInfo = getLayerByName(dataset, layerName);
  // If there is a fallbackLayer, request mappings for that instead of the tracing segmentation layer
  const mappingLayerName =
    "fallbackLayer" in layerInfo && layerInfo.fallbackLayer != null
      ? layerInfo.fallbackLayer
      : layerName;
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
  const dataset = yield* select((state) => state.dataset);
  const segmentationLayer = getLayerByName(dataset, layerName);

  if (segmentationLayer.category !== "segmentation") {
    throw new Error("Mappings only exist for segmentation layers.");
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
  const largestSegmentID = yield* call(getLargestSegmentId, layerName);
  const maxId = largestSegmentID + 1;
  // Initialize to the next multiple of 256 that is larger than maxId
  let newMappedId = Math.ceil(maxId / 256) * 256;

  for (const currentMappingName of getMappingChain(mappingName, fetchedMappings)) {
    const mapping = fetchedMappings[currentMappingName];
    ErrorHandling.assertExists(
      mapping.classes,
      "Mappings must have been fetched at this point. Ensure that the mapping JSON contains a classes property.",
    );

    if (mapping.classes) {
      for (const mappingClass of mapping.classes) {
        const minId = assignNewIds ? newMappedId : _.min(mappingClass);
        // @ts-expect-error ts-migrate(2538) FIXME: Type 'undefined' cannot be used as an index type.
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
