import _ from "lodash";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { all, call, takeEvery, takeLatest, take, put, fork, actionChannel } from "typed-redux-saga";
import { select } from "oxalis/model/sagas/effect-generators";
import { message } from "antd";
import type {
  OptionalMappingProperties,
  SetMappingAction,
  SetMappingEnabledAction,
} from "oxalis/model/actions/settings_actions";
import { setMappingAction, setMappingEnabledAction } from "oxalis/model/actions/settings_actions";
import {
  fetchMapping,
  getMappingsForDatasetLayer,
  getAgglomeratesForDatasetLayer,
  getAgglomerateMapping,
  getAgglomeratesForSegmentsFromDatastore,
  getAgglomeratesForSegmentsFromTracingstore,
} from "admin/admin_rest_api";
import type { APIMapping } from "types/api_flow_types";
import {
  EnsureLayerMappingsAreLoadedAction,
  setLayerMappingsAction,
} from "oxalis/model/actions/dataset_actions";
import {
  getLayerByName,
  getMappingInfo,
  getVisibleSegmentationLayer,
} from "oxalis/model/accessors/dataset_accessor";
import type { ActiveMappingInfo, Mapping } from "oxalis/store";
import ErrorHandling from "libs/error_handling";
import { MAPPING_MESSAGE_KEY } from "oxalis/model/bucket_data_handling/mappings";
import { Model, api } from "oxalis/singletons";
import { MappingStatusEnum } from "oxalis/constants";
import {
  isMappingActivationAllowed,
  hasEditableMapping,
  getEditableMappingForVolumeTracingId,
} from "oxalis/model/accessors/volumetracing_accessor";
import Toast from "libs/toast";
import { jsHsv2rgb } from "oxalis/shaders/utils.glsl";
import { updateSegmentAction } from "../actions/volumetracing_actions";
import { sleep } from "libs/utils";
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
  yield* takeLatest(setMappingActionChannel, handleSetMapping, oldActiveMappingByLayer);
  // yield* takeEvery(mappingChangeActionChannel, maybeReloadData, oldActiveMappingByLayer);
  yield* takeEvery(
    "ENSURE_LAYER_MAPPINGS_ARE_LOADED",
    function* handler(action: EnsureLayerMappingsAreLoadedAction) {
      const layerName =
        action.layerName || (yield* select((state) => getVisibleSegmentationLayer(state)?.name));
      if (layerName) {
        yield* loadLayerMappings(layerName, true);
      }
    },
  );
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

function* loadLayerMappings(layerName: string, updateInStore: boolean): Saga<[string[], string[]]> {
  const dataset = yield* select((state) => state.dataset);
  const layerInfo = getLayerByName(dataset, layerName);

  if (layerInfo.category === "color") {
    throw new Error("loadLayerMappings was called with a color layer.");
  }

  if (layerInfo.mappings != null && layerInfo.agglomerates != null) {
    return [layerInfo.mappings, layerInfo.agglomerates];
  }

  const params = [
    dataset.dataStore.url,
    dataset, // If there is a fallbackLayer, request mappings for that instead of the tracing segmentation layer
    "fallbackLayer" in layerInfo && layerInfo.fallbackLayer != null
      ? layerInfo.fallbackLayer
      : layerInfo.name,
  ] as const;
  const [jsonMappings, serverHdf5Mappings] = yield* all([
    call(getMappingsForDatasetLayer, ...params),
    call(getAgglomeratesForDatasetLayer, ...params),
  ]);

  if (updateInStore) {
    yield* put(setLayerMappingsAction(layerName, jsonMappings, serverHdf5Mappings));
  }

  return [jsonMappings, serverHdf5Mappings];
}

function* handleSetMapping(
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

  if (mappingName == null) {
    return;
  }
  if (existingMapping != null) {
    // A fully fledged mapping object was already passed
    // (e.g., via the front-end API).
    // Only the custom colors have to be configured, if they
    // were passed.
    if (action.mappingColors) {
      const classes = convertMappingObjectToClasses(existingMapping);
      yield* call(setCustomColors, action, classes, layerName);
    }
    return;
  }

  if (showLoadingIndicator) {
    message.loading({
      content: "Activating Mapping",
      key: MAPPING_MESSAGE_KEY,
    });
  }

  const dataset = yield* select((state) => state.dataset);
  const annotation = yield* select((state) => state.tracing);
  const layerInfo = getLayerByName(dataset, layerName);

  // Make sure the available mappings are persisted in the store if they are not already
  const areServerHdf5MappingsInStore =
    "agglomerates" in layerInfo && layerInfo.agglomerates != null;
  const [jsonMappings, serverHdf5Mappings] = yield* call(
    loadLayerMappings,
    layerName,
    !areServerHdf5MappingsInStore,
  );

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
  // be a race between the maybeReloadData and handleSetMapping sagas
  // yield* fork(maybeReloadData, oldActiveMappingByLayer, action);

  if (mappingType !== "JSON") {
    const dataset = yield* select((state) => state.dataset);
    const layerInfo = getLayerByName(dataset, layerName);
    // If there is a fallbackLayer, request mappings for that instead of the tracing segmentation layer
    const mappingLayerName =
      "fallbackLayer" in layerInfo && layerInfo.fallbackLayer != null
        ? layerInfo.fallbackLayer
        : layerName;

    yield* call(sleep, 5000);

    const isEditableMappingActive = yield* select((state) => hasEditableMapping(state, layerName));
    const editableMapping = yield* select((state) =>
      getEditableMappingForVolumeTracingId(state, layerName),
    );
    const cube = Model.getCubeByLayerName(layerName);
    const uniqueSegmentIds = Array.from(cube.getValueSetForAllBuckets()).sort((a, b) => a - b);

    const mapping = isEditableMappingActive
      ? yield* call(
          getAgglomeratesForSegmentsFromTracingstore,
          annotation.tracingStore.url,
          editableMapping.tracingId,
          uniqueSegmentIds,
        )
      : yield* call(
          getAgglomeratesForSegmentsFromDatastore,
          dataset.dataStore.url,
          dataset,
          mappingLayerName,
          mappingName,
          uniqueSegmentIds,
        );

    const mappingProperties = {
      mapping,
      mappingKeys: uniqueSegmentIds,
    };

    // // Load Full Mapping
    // const agglomerateMapping = yield* call(
    //   getAgglomerateMapping,
    //   dataset.dataStore.url,
    //   dataset,
    //   mappingLayerName,
    //   mappingName,
    // );

    // const mappingProperties = {
    //   mapping: Object.fromEntries(agglomerateMapping.map((value, index) => [index, value])),
    //   mappingKeys: _.range(agglomerateMapping.length),
    // };

    yield* put(setMappingAction(layerName, mappingName, mappingType, mappingProperties));
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
  const fetchedMapping = fetchedMappings[mappingName];
  const { hideUnmappedIds, colors: mappingColors } = fetchedMapping;

  const [mappingObject, mappingKeys] = yield* call(
    buildMappingObject,
    mappingName,
    fetchedMappings,
  );
  const mappingProperties = {
    mapping: mappingObject,
    mappingKeys,
    mappingColors,
    hideUnmappedIds,
  };

  const usesCustomColors = mappingColors != null && mappingColors.length > 0;
  if (usesCustomColors) {
    yield* call(setCustomColors, mappingProperties, fetchedMapping.classes || [], layerName);
  }

  if (layerInfo.elementClass === "uint64") {
    yield* call(
      [Toast, Toast.warning],
      "The activated mapping will only be valid for the lower 32-bits of the active 64-bit segmentation.",
      { sticky: true },
    );
  }

  yield* put(setMappingAction(layerName, mappingName, mappingType, mappingProperties));
}

function convertMappingObjectToClasses(existingMapping: Mapping) {
  const classesByRepresentative: Record<number, number[]> = {};
  for (const unmappedStr of Object.keys(existingMapping)) {
    const unmapped = Number(unmappedStr);
    const mapped = existingMapping[unmapped];
    classesByRepresentative[mapped] = classesByRepresentative[mapped] || [];
    classesByRepresentative[mapped].push(unmapped);
  }
  const classes = Object.values(classesByRepresentative);
  return classes;
}

function* setCustomColors(
  mappingProperties: OptionalMappingProperties,
  classes: number[][],
  layerName: string,
) {
  if (mappingProperties.mapping == null || mappingProperties.mappingColors == null) {
    return;
  }
  let classIdx = 0;
  for (const aClass of classes) {
    const firstIdEntry = aClass[0];
    if (firstIdEntry == null) {
      continue;
    }
    const representativeId = mappingProperties.mapping[firstIdEntry];

    const hueValue = mappingProperties.mappingColors[classIdx];
    const color = jsHsv2rgb(360 * hueValue, 1, 1);
    yield* put(updateSegmentAction(representativeId, { color }, layerName));

    classIdx++;
  }
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

function buildMappingObject(
  mappingName: string,
  fetchedMappings: APIMappings,
): [Mapping, Array<number>] {
  const mappingObject: Mapping = {};
  // Performance optimization: Object.keys(...) is slow for large objects
  // keeping track of the keys in a separate array is ~5x faster
  const mappingKeys = [];

  for (const currentMappingName of getMappingChain(mappingName, fetchedMappings)) {
    const mapping = fetchedMappings[currentMappingName];
    ErrorHandling.assertExists(
      mapping.classes,
      "Mappings must have been fetched at this point. Ensure that the mapping JSON contains a classes property.",
    );

    for (const mappingClass of mapping.classes) {
      const minId = _.min(mappingClass);
      if (minId == null) {
        // The class is empty and can be ignored
        continue;
      }
      const mappedId = mappingObject[minId] || minId;

      for (const id of mappingClass) {
        mappingObject[id] = mappedId;
        mappingKeys.push(id);
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
