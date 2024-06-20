import _ from "lodash";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import {
  all,
  call,
  cancel,
  fork,
  takeEvery,
  takeLatest,
  take,
  put,
  race,
  actionChannel,
  flush,
} from "typed-redux-saga";
import { api } from "oxalis/singletons";
import { buffers, eventChannel } from "redux-saga";
import { select } from "oxalis/model/sagas/effect-generators";
import { message } from "antd";
import type {
  OptionalMappingProperties,
  SetMappingAction,
} from "oxalis/model/actions/settings_actions";
import {
  clearMappingAction,
  finishMappingInitializationAction,
  setMappingAction,
} from "oxalis/model/actions/settings_actions";
import {
  fetchMapping,
  getMappingsForDatasetLayer,
  getAgglomeratesForDatasetLayer,
  getAgglomeratesForSegmentsFromDatastore,
  getAgglomeratesForSegmentsFromTracingstore,
} from "admin/admin_rest_api";
import type { APIDataLayer, APIMapping } from "types/api_flow_types";
import {
  EnsureLayerMappingsAreLoadedAction,
  setLayerMappingsAction,
} from "oxalis/model/actions/dataset_actions";
import {
  getLayerByName,
  getMappingInfo,
  getVisibleSegmentationLayer,
} from "oxalis/model/accessors/dataset_accessor";
import type {
  ActiveMappingInfo,
  Mapping,
  MappingType,
  NumberLike,
  NumberLikeMap,
} from "oxalis/store";
import ErrorHandling from "libs/error_handling";
import { MAPPING_MESSAGE_KEY } from "oxalis/model/bucket_data_handling/mappings";
import { Model } from "oxalis/singletons";
import {
  isMappingActivationAllowed,
  hasEditableMapping,
  getEditableMappingForVolumeTracingId,
  needsLocalHdf5Mapping as getNeedsLocalHdf5Mapping,
  getVolumeTracings,
  getBucketRetrievalSourceFn,
  BucketRetrievalSource,
} from "oxalis/model/accessors/volumetracing_accessor";
import Toast from "libs/toast";
import { jsHsv2rgb } from "oxalis/shaders/utils.glsl";
import { updateSegmentAction } from "../actions/volumetracing_actions";
import { MappingStatusEnum } from "oxalis/constants";
import DataCube from "../bucket_data_handling/data_cube";
import { chainIterators, diffMaps, diffSets, sleep } from "libs/utils";
import { Action } from "../actions/actions";
import { ActionPattern } from "redux-saga/effects";
import { listenToStoreProperty } from "../helpers/listener_helpers";
import memoizeOne from "memoize-one";

type APIMappings = Record<string, APIMapping>;
type Container<T> = { value: T };

const takeLatestMappingChange = (
  oldActiveMappingByLayer: Container<Record<string, ActiveMappingInfo>>,
  layerName: string,
) => {
  return fork(function* () {
    let lastWatcherTask;
    let lastBucketRetrievalSource;

    const needsLocalMappingChangedChannel = createNeedsLocalMappingChangedChannel(layerName);
    const getBucketRetrievalSourceForLayer = getBucketRetrievalSourceFn(layerName);
    while (true) {
      lastBucketRetrievalSource = yield* select((state) => getBucketRetrievalSourceForLayer(state));
      const bucketRetrievalSource = yield* take(needsLocalMappingChangedChannel);

      console.log("changed from", lastBucketRetrievalSource, "to", bucketRetrievalSource);

      if (lastWatcherTask) {
        console.log("Cancel old bucket watcher");
        yield cancel(lastWatcherTask);
        lastWatcherTask = null;
      }

      // Changing between REQUESTED-WITH-MAPPING <> REQUESTED-WITHOUT-MAPPING
      if (lastBucketRetrievalSource[0] !== bucketRetrievalSource[0]) {
        yield* call(maybeReloadData, oldActiveMappingByLayer, { layerName }, true);
      }

      const needsLocalHdf5Mapping = yield* select((state) =>
        getNeedsLocalHdf5Mapping(state, layerName),
      );
      if (needsLocalHdf5Mapping) {
        // Start a new watcher
        console.log("Start new bucket watcher for layer", layerName);
        lastWatcherTask = yield* fork(watchChangedBucketsForLayer, layerName);
      } else if (
        lastBucketRetrievalSource[0] === "REQUESTED-WITHOUT-MAPPING" &&
        lastBucketRetrievalSource[1] === "LOCAL-MAPPING-APPLIED"
      ) {
        // needsLocalHdf5Mapping is false, but in the last iteration, a local mapping
        // was applied. Therefore, we have to set the mapping to undefined
        yield* put(clearMappingAction(layerName));
      }
    }
  });
};

// function runWhenSelectorChanged<T>(selector: (state: OxalisState) => T, saga: (t: T) => Saga<any>) {
//   return fork(function* () {
//     let previous = yield* select(selector);
//     while (true) {
//       yield* take();
//       const next = yield* select(selector);
//       if (next !== previous) {
//         yield* call(saga, next);
//         previous = next;
//       }
//     }
//   });
// }

// function* handleChangeOfNeedsLocalHdf5Mapping(layerName: string, needsLocalHdf5Mapping: boolean) {}

export default function* watchActivatedMappings(): Saga<void> {
  const oldActiveMappingByLayer = {
    value: yield* select((state) => state.temporaryConfiguration.activeMappingByLayer),
  };
  // Buffer actions since they might be dispatched before WK_READY
  const setMappingActionChannel = yield* actionChannel("SET_MAPPING");
  yield* take("WK_READY");
  yield* takeLatest(setMappingActionChannel, handleSetMapping, oldActiveMappingByLayer);
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
  const volumeTracings = yield* select((state) => getVolumeTracings(state.tracing));
  for (const tracing of volumeTracings) {
    // The following two sagas will fork internally.
    yield* takeLatestMappingChange(oldActiveMappingByLayer, tracing.tracingId);

    // const selector = (state: OxalisState) => getNeedsLocalHdf5Mapping(state, layerName);

    // yield* runWhenSelectorChanged(
    //   selector,
    //   handleChangeOfNeedsLocalHdf5Mapping.bind(null, layerName),
    // );
  }
}

const isAgglomerate = (mapping: ActiveMappingInfo) => {
  return mapping.mappingType === "HDF5";
};

function* maybeReloadData(
  oldActiveMappingByLayer: Container<Record<string, ActiveMappingInfo>>,
  action: { layerName: string },
  forceReload: boolean = false,
): Saga<void> {
  // todop: respect needsLocalHdf5Mapping?
  const { layerName } = action;
  const oldMapping = getMappingInfo(oldActiveMappingByLayer.value, layerName);
  const activeMappingByLayer = yield* select(
    (state) => state.temporaryConfiguration.activeMappingByLayer,
  );
  const mapping = getMappingInfo(activeMappingByLayer, layerName);
  const isAgglomerateMappingInvolved = isAgglomerate(oldMapping) || isAgglomerate(mapping);
  const hasChanged = oldMapping !== mapping;
  const shouldReload = isAgglomerateMappingInvolved && hasChanged;

  if (forceReload || shouldReload) {
    console.log("reload", forceReload, shouldReload);
    yield* call([api.data, api.data.reloadBuckets], layerName);
  } else {
    console.log("don't reload");
  }

  // If an agglomerate mapping is being activated, the data reload is the last step
  // of the mapping activation. For JSON mappings, the last step of the mapping activation
  // is the texture creation in mappings.js
  if (isAgglomerate(mapping) && mapping.mappingStatus === MappingStatusEnum.ACTIVATING) {
    yield* put(finishMappingInitializationAction(layerName));
    message.destroy(MAPPING_MESSAGE_KEY);
  }

  oldActiveMappingByLayer.value = activeMappingByLayer;
}

function createBucketDataChangedChannel(dataCube: DataCube) {
  return eventChannel((emit) => {
    const bucketDataChangedHandler = () => {
      emit("BUCKET_DATA_CHANGED");
    };

    const unbind = dataCube.emitter.on("bucketDataChanged", bucketDataChangedHandler);
    return unbind;
  }, buffers.sliding<string>(1));
}

function createNeedsLocalMappingChangedChannel(layerName: string) {
  const getBucketRetrievalSourceForLayer = getBucketRetrievalSourceFn(layerName);
  return eventChannel((emit) => {
    const unbind = listenToStoreProperty(
      (state) => getBucketRetrievalSourceForLayer(state),
      (retrievalSource) => emit(retrievalSource),
    );
    return unbind;
  }, buffers.sliding<BucketRetrievalSource>(1));
}

function* watchChangedBucketsForLayer(layerName: string): Saga<void> {
  const dataCube = yield* call([Model, Model.getCubeByLayerName], layerName);
  const bucketChannel = yield* call(createBucketDataChangedChannel, dataCube);

  while (true) {
    yield take(bucketChannel);
    // We received a BUCKET_DATA_CHANGED event. `handler` needs to be invoked.
    // However, let's throttle¹ this by waiting and then discarding all other events
    // that might have accumulated in between.
    yield* call(sleep, 500);
    yield flush(bucketChannel);
    // After flushing and while the handler below is running,
    // the bucketChannel might fill up again. This means, the
    // next loop will immediately take from the channel which
    // is what we need.
    yield* call(handler);

    // Addendum:
    // ¹ We don't use redux-saga's throttle, because that would
    //   cause call `handler` in parallel if enough events are
    //   consumed across over throttling duration.
    //   However, running `handler` in parallel would be a waste
    //   of computation. Therefore, we invoke `handler` strictly
    //   sequentially.
  }

  function* handler() {
    const dataset = yield* select((state) => state.dataset);
    const layerInfo = getLayerByName(dataset, layerName);
    const mappingInfo = yield* select((state) =>
      getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, layerName),
    );
    const { mappingName, mappingType, mappingStatus } = mappingInfo;

    if (mappingName == null || mappingStatus !== MappingStatusEnum.ENABLED) {
      return;
    }

    console.log("starting updateHdf5 because a bucket changed");

    // Updating the HDF5 mapping is an async task which requires communication with
    // the back-end. If the front-end does a proofreading operation in parallel,
    // there is a risk of a race condition. Therefore, we cancel the updateHdf5
    // saga as soon as WK enters a busy state and retry afterwards.
    while (true) {
      let isBusy = yield* select((state) => state.uiInformation.busyBlockingInfo.isBusy);
      if (!isBusy) {
        const { cancel } = yield* race({
          updateHdf5: call(updateLocalHdf5Mapping, layerName, layerInfo, mappingName, mappingType),
          cancel: take(
            ((action: Action) =>
              action.type === "SET_BUSY_BLOCKING_INFO_ACTION" &&
              action.value.isBusy) as ActionPattern,
          ),
        });
        if (!cancel) {
          return;
        }
        console.log("cancelled updateHdf5");
      }

      isBusy = yield* select((state) => state.uiInformation.busyBlockingInfo.isBusy);
      console.log("isBusy", isBusy);
      if (isBusy) {
        yield* take(
          ((action: Action) =>
            action.type === "SET_BUSY_BLOCKING_INFO_ACTION" &&
            !action.value.isBusy) as ActionPattern,
        );
      }

      console.log("retrying updateHdf5");
    }
  }
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
  oldActiveMappingByLayer: Container<Record<string, ActiveMappingInfo>>,
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
      const classes = convertMappingObjectToEquivalenceClasses(existingMapping);
      yield* call(setCustomColors, action, classes, layerName);
    }
    return;
  }
  console.time("MappingActivation");
  console.time("MappingSaga");

  if (showLoadingIndicator) {
    message.loading({
      content: "Activating Mapping",
      key: MAPPING_MESSAGE_KEY,
    });
  }

  const layerInfo = yield* select((state) => getLayerByName(state.dataset, layerName));

  const success = yield* call(
    ensureMappingsAreLoadedAndRequestedMappingExists,
    layerInfo,
    mappingName,
    mappingType,
  );
  if (!success) {
    return;
  }

  if (mappingType === "JSON") {
    yield* call(handleSetJsonMapping, layerName, layerInfo, mappingName, mappingType);
  } else if (mappingType === "HDF5") {
    yield* call(
      handleSetHdf5Mapping,
      layerName,
      layerInfo,
      mappingName,
      mappingType,
      action,
      oldActiveMappingByLayer,
    );
  }
}

function* handleSetHdf5Mapping(
  layerName: string,
  layerInfo: APIDataLayer,
  mappingName: string,
  mappingType: MappingType,
  action: SetMappingAction,
  oldActiveMappingByLayer: Container<Record<string, ActiveMappingInfo>>,
): Saga<void> {
  if (yield* select((state) => getNeedsLocalHdf5Mapping(state, layerName))) {
    yield* call(updateLocalHdf5Mapping, layerName, layerInfo, mappingName, mappingType);
  } else {
    yield* call(maybeReloadData, oldActiveMappingByLayer, action);
  }
}

function diffMappings(
  mappingA: Mapping,
  mappingB: Mapping,
  cacheResult?: ReturnType<typeof diffMaps>,
) {
  if (cacheResult != null) {
    return cacheResult;
  }
  return diffMaps<number | bigint, number | bigint>(mappingA, mappingB);
}

export const cachedDiffMappings = memoizeOne(
  diffMappings,
  (newInputs, lastInputs) =>
    // If cacheResult was passed, the inputs must be considered as not equal
    // so that the new result can be set
    newInputs[2] == null && newInputs[0] === lastInputs[0] && newInputs[1] === lastInputs[1],
);
export const setCacheResultForDiffMappings = (
  mappingA: Mapping,
  mappingB: Mapping,
  cacheResult: ReturnType<typeof diffMaps>,
) => {
  cachedDiffMappings(mappingA, mappingB, cacheResult);
};

function* updateLocalHdf5Mapping(
  layerName: string,
  layerInfo: APIDataLayer,
  mappingName: string,
  mappingType: MappingType,
): Saga<void> {
  const dataset = yield* select((state) => state.dataset);
  const annotation = yield* select((state) => state.tracing);
  // If there is a fallbackLayer, request mappings for that instead of the tracing segmentation layer
  const mappingLayerName =
    "fallbackLayer" in layerInfo && layerInfo.fallbackLayer != null
      ? layerInfo.fallbackLayer
      : layerName;

  const isEditableMappingActive = yield* select((state) => hasEditableMapping(state, layerName));
  const editableMapping = yield* select((state) =>
    getEditableMappingForVolumeTracingId(state, layerName),
  );

  const cube = Model.getCubeByLayerName(layerName);
  const segmentIds = cube.getValueSetForAllBuckets();

  const previousMapping = yield* select(
    (store) =>
      store.temporaryConfiguration.activeMappingByLayer[layerName].mapping ||
      (new Map() as Mapping),
  );

  console.time("set operations in mapping saga");
  const {
    aWithoutB: newSegmentIds,
    bWithoutA: deletedValues,
    intersection: remainingValues,
  } = diffSets(
    segmentIds as Set<NumberLike>,
    new Set((previousMapping as Map<NumberLike, NumberLike>).keys()),
  );

  const newUniqueSegmentIds = [...newSegmentIds].sort(<T extends NumberLike>(a: T, b: T) => a - b);
  console.timeEnd("set operations in mapping saga");
  console.log(
    "New values",
    newSegmentIds.size,
    "remaining values",
    remainingValues.size,
    "previous size",
    previousMapping.size,
  );

  console.log("asking server to map segment ids");
  const newEntries =
    isEditableMappingActive && editableMapping != null
      ? yield* call(
          getAgglomeratesForSegmentsFromTracingstore,
          annotation.tracingStore.url,
          editableMapping.tracingId,
          newUniqueSegmentIds,
        )
      : yield* call(
          getAgglomeratesForSegmentsFromDatastore,
          dataset.dataStore.url,
          dataset,
          mappingLayerName,
          mappingName,
          newUniqueSegmentIds,
        );
  console.log("received mapped segment ids from server", newEntries);

  const previousEntries = [...previousMapping.entries()] as Array<[NumberLike, NumberLike]>;
  const remainingEntries = previousEntries.filter(([key, _]) => remainingValues.has(key));
  const chainedIterator = chainIterators<NumberLike>(
    // @ts-ignore remainingEntries and newEntries are expected to have the same value type
    remainingEntries,
    newEntries.entries(),
  );
  const mapping = new Map(chainedIterator) as Mapping;

  setCacheResultForDiffMappings(previousMapping, mapping, {
    changed: [],
    onlyA: Array.from(deletedValues),
    onlyB: newUniqueSegmentIds,
  });

  console.log("dispatch setMappingAction in mapping saga");
  yield* put(setMappingAction(layerName, mappingName, mappingType, { mapping }));
}

function* handleSetJsonMapping(
  layerName: string,
  layerInfo: APIDataLayer,
  mappingName: string,
  mappingType: MappingType,
): Saga<void> {
  console.time("MappingSaga JSON");
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

  const mapping = yield* call(buildMappingObject, mappingName, fetchedMappings);
  const mappingProperties = {
    mapping,
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
  console.timeEnd("MappingSaga JSON");
  yield* put(setMappingAction(layerName, mappingName, mappingType, mappingProperties));
}

function convertMappingObjectToEquivalenceClasses(existingMapping: Mapping) {
  const classesByRepresentative: Record<number, number[]> = {};
  for (const unmapped of existingMapping.keys()) {
    // @ts-ignore unmapped is guaranteed to exist in existingMapping as it was obtained using existingMapping.keys()
    const mapped: number = existingMapping.get(unmapped);
    classesByRepresentative[mapped] = classesByRepresentative[mapped] || [];
    if (typeof unmapped === "bigint") {
      // todop
      console.warn("Casting BigInt to Number for custom colors.");
    }
    classesByRepresentative[mapped].push(Number(unmapped));
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
    if (firstIdEntry == null) continue;

    const representativeId = (mappingProperties.mapping as NumberLikeMap).get(firstIdEntry);
    if (representativeId == null) continue;

    const hueValue = mappingProperties.mappingColors[classIdx];
    const color = jsHsv2rgb(360 * hueValue, 1, 1);
    if (typeof representativeId === "bigint") {
      // todop
      console.warn("Casting BigInt to Number for custom colors.");
    }
    yield* put(updateSegmentAction(Number(representativeId), { color }, layerName));

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

function buildMappingObject(mappingName: string, fetchedMappings: APIMappings): Mapping {
  const mappingObject = new Map<number, number>();

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
      const mappedId = mappingObject.get(minId) || minId;

      for (const id of mappingClass) {
        mappingObject.set(id, mappedId);
      }
    }
  }

  return mappingObject;
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

function* ensureMappingsAreLoadedAndRequestedMappingExists(
  layerInfo: APIDataLayer,
  mappingName: string,
  mappingType: MappingType,
) {
  const { name: layerName } = layerInfo;
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
      .filter((volumeTracing) => volumeTracing.hasEditableMapping)
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
    return false;
  }

  return true;
}
