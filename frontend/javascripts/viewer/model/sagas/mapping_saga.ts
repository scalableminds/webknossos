import {
  fetchMapping,
  getAgglomeratesForDatasetLayer,
  getAgglomeratesForSegmentsFromDatastore,
  getAgglomeratesForSegmentsFromTracingstore,
  getMappingsForDatasetLayer,
} from "admin/rest_api";
import { message } from "antd";
import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import { fastDiffSetAndMap, sleep } from "libs/utils";
import _ from "lodash";
import { buffers, eventChannel } from "redux-saga";
import type { ActionPattern } from "redux-saga/effects";
import {
  actionChannel,
  all,
  call,
  cancel,
  flush,
  fork,
  put,
  race,
  take,
  takeEvery,
  takeLatest,
} from "typed-redux-saga";
import type { APIDataLayer, APIMapping } from "types/api_types";
import { MappingStatusEnum } from "viewer/constants";
import {
  getLayerByName,
  getMappingInfo,
  getSegmentationLayers,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import {
  type BucketRetrievalSource,
  getBucketRetrievalSourceFn,
  getEditableMappingForVolumeTracingId,
  needsLocalHdf5Mapping as getNeedsLocalHdf5Mapping,
  isMappingActivationAllowed,
} from "viewer/model/accessors/volumetracing_accessor";
import {
  type EnsureLayerMappingsAreLoadedAction,
  setLayerMappingsAction,
} from "viewer/model/actions/dataset_actions";
import type {
  OptionalMappingProperties,
  SetMappingAction,
} from "viewer/model/actions/settings_actions";
import {
  clearMappingAction,
  finishMappingInitializationAction,
  setMappingAction,
} from "viewer/model/actions/settings_actions";
import {
  MAPPING_MESSAGE_KEY,
  setCacheResultForDiffMappings,
} from "viewer/model/bucket_data_handling/mappings";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import { jsHsv2rgb } from "viewer/shaders/utils.glsl";
import { api } from "viewer/singletons";
import { Model } from "viewer/singletons";
import type {
  ActiveMappingInfo,
  Mapping,
  MappingType,
  NumberLike,
  NumberLikeMap,
} from "viewer/store";
import type { Action } from "../actions/actions";
import { updateSegmentAction } from "../actions/volumetracing_actions";
import type DataCube from "../bucket_data_handling/data_cube";
import { listenToStoreProperty } from "../helpers/listener_helpers";
import { ensureWkReady } from "./ready_sagas";

type APIMappings = Record<string, APIMapping>;
type Container<T> = { value: T };

const BUCKET_WATCHING_THROTTLE_DELAY = process.env.IS_TESTING ? 5 : 500;

const takeLatestMappingChange = (
  oldActiveMappingByLayer: Container<Record<string, ActiveMappingInfo>>,
  layerName: string,
) => {
  return fork(function* () {
    let lastWatcherTask;
    let lastBucketRetrievalSource;

    const bucketRetrievalSourceChannel = createBucketRetrievalSourceChannel(layerName);
    const getBucketRetrievalSourceForLayer = getBucketRetrievalSourceFn(layerName);
    while (true) {
      lastBucketRetrievalSource = yield* select((state) => getBucketRetrievalSourceForLayer(state));
      const bucketRetrievalSource = yield* take(bucketRetrievalSourceChannel);

      const activeMappingByLayer = yield* select(
        (state) => state.temporaryConfiguration.activeMappingByLayer,
      );
      const mapping = getMappingInfo(activeMappingByLayer, layerName);

      if (process.env.NODE_ENV === "production") {
        console.log("Changed from", lastBucketRetrievalSource, "to", bucketRetrievalSource);
      }

      if (lastWatcherTask) {
        console.log("Cancel old bucket watcher");
        yield cancel(lastWatcherTask);
        lastWatcherTask = null;
      }

      // Changing between REQUESTED-WITH-MAPPING <> REQUESTED-WITHOUT-MAPPING
      if (lastBucketRetrievalSource[0] !== bucketRetrievalSource[0]) {
        yield* call(reloadData, oldActiveMappingByLayer, { layerName });
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
        lastBucketRetrievalSource[1] === "LOCAL-MAPPING-APPLIED" &&
        mapping.mappingType !== "JSON"
      ) {
        // needsLocalHdf5Mapping is false, but in the last iteration, a local mapping
        // was applied. In case of a HDF5 mapping, this means that the mapping should
        // now be applied by the back-end. We have to clear the mapping so that
        // the data from the back-end is not mapped again.
        yield* put(clearMappingAction(layerName));
      }
    }
  });
};

export default function* watchActivatedMappings(): Saga<void> {
  const oldActiveMappingByLayer = {
    value: yield* select((state) => state.temporaryConfiguration.activeMappingByLayer),
  };
  // Buffer actions since they might be dispatched before WK_READY
  const setMappingActionChannel = yield* actionChannel("SET_MAPPING");
  yield* call(ensureWkReady);
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
  const segmentationLayers = yield* select((state) => getSegmentationLayers(state.dataset));
  for (const layer of segmentationLayers) {
    // The following saga will fork internally.
    yield* takeLatestMappingChange(oldActiveMappingByLayer, layer.name);
  }
}

const isAgglomerate = (mapping: ActiveMappingInfo) => {
  return mapping.mappingType === "HDF5";
};

function* reloadData(
  oldActiveMappingByLayer: Container<Record<string, ActiveMappingInfo>>,
  action: { layerName: string },
): Saga<void> {
  const { layerName } = action;
  const activeMappingByLayer = yield* select(
    (state) => state.temporaryConfiguration.activeMappingByLayer,
  );
  const mapping = getMappingInfo(activeMappingByLayer, layerName);

  // Especially, when switching between move tool and proofreading tool for the first time
  // a latency is to be expected. Therefore, we want to notify the user about what's happening.
  // After a proofreading action has been made, tool switching won't cause a layer reload.
  message.loading({
    content: "Reloading segmentation data...",
    duration: 1,
  });
  yield* call([api.data, api.data.reloadBuckets], layerName);

  const needsLocalHdf5Mapping = yield* select((state) =>
    getNeedsLocalHdf5Mapping(state, layerName),
  );

  // If an agglomerate mapping is being activated (that is applied remotely), the data
  // reload is the last step of the mapping activation. For JSON mappings or locally applied
  // HDF5 mappings, the last step of the mapping activation is the texture creation in mappings.ts
  if (isAgglomerate(mapping) && !needsLocalHdf5Mapping) {
    if (mapping.mappingStatus === MappingStatusEnum.ACTIVATING) {
      yield* put(finishMappingInitializationAction(layerName));
      message.destroy(MAPPING_MESSAGE_KEY);
    } else if (mapping.mappingStatus === MappingStatusEnum.ENABLED) {
      // If the mapping is already enabled (happens when an annotation was loaded initially
      // with a remotely applied hdf5 mapping), ensure that the message to the user is hidden, too.
      message.destroy(MAPPING_MESSAGE_KEY);
    }
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

function createBucketRetrievalSourceChannel(layerName: string) {
  const getBucketRetrievalSourceForLayer = getBucketRetrievalSourceFn(layerName);
  return eventChannel((emit) => {
    const unbind = listenToStoreProperty(
      (state) => getBucketRetrievalSourceForLayer(state),
      (retrievalSource) => emit(retrievalSource),
    );
    return unbind;
  }, buffers.sliding<BucketRetrievalSource>(1));
}

function* watchChangedBucketsForLayer(layerName: string): Saga<never> {
  /*
   * This saga listens for changed bucket data and then triggers the updateLocalHdf5Mapping
   * saga in an interruptible manner. See comments below for some rationale.
   */
  const dataCube = yield* call([Model, Model.getCubeByLayerName], layerName);
  const bucketChannel = yield* call(createBucketDataChangedChannel, dataCube);

  // Also update the local hdf5 mapping by inspecting all already existing
  // buckets (likely, there are none yet because all buckets were reloaded, but
  // it's still safer to do this here).
  yield* call(startInterruptibleUpdateMapping);

  while (true) {
    yield take(bucketChannel);
    // We received a BUCKET_DATA_CHANGED event. `startInterruptibleUpdateMapping` needs
    // to be invoked.
    // However, let's throttle¹ this by waiting and then discarding all other events
    // that might have accumulated in between.

    yield* call(sleep, BUCKET_WATCHING_THROTTLE_DELAY);
    yield flush(bucketChannel);
    // After flushing and while the startInterruptibleUpdateMapping below is running,
    // the bucketChannel might fill up again. This means, the
    // next loop will immediately take from the channel which
    // is what we need.
    yield* call(startInterruptibleUpdateMapping);

    // Addendum:
    // ¹ We don't use redux-saga's throttle, because that would
    //   call `startInterruptibleUpdateMapping` in parallel if enough events are
    //   consumed over the throttling duration.
    //   However, running `startInterruptibleUpdateMapping` in parallel would be a waste
    //   of computation. Therefore, we invoke `startInterruptibleUpdateMapping` strictly
    //   sequentially.
  }

  function* startInterruptibleUpdateMapping() {
    const dataset = yield* select((state) => state.dataset);
    const layerInfo = getLayerByName(dataset, layerName);
    const mappingInfo = yield* select((state) =>
      getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, layerName),
    );
    const { mappingName, mappingStatus } = mappingInfo;

    if (mappingName == null || mappingStatus !== MappingStatusEnum.ENABLED) {
      return;
    }

    // Updating the HDF5 mapping is an async task which requires communication with
    // the back-end. If the front-end does a proofreading operation in parallel,
    // there is a risk of a race condition. Therefore, we cancel the updateHdf5
    // saga as soon as WK enters a busy state and retry afterwards.
    while (true) {
      let isBusy = yield* select((state) => state.uiInformation.busyBlockingInfo.isBusy);
      if (!isBusy) {
        const { cancel } = yield* race({
          updateHdf5: call(updateLocalHdf5Mapping, layerName, layerInfo, mappingName),
          cancel: take(
            ((action: Action) =>
              action.type === "SET_BUSY_BLOCKING_INFO_ACTION" &&
              action.value.isBusy) as ActionPattern,
          ),
        });
        if (!cancel) {
          return;
        }
        console.log("Cancelled updateHdf5");
      }

      isBusy = yield* select((state) => state.uiInformation.busyBlockingInfo.isBusy);
      if (isBusy) {
        // Wait until WK is not busy anymore.
        yield* take(
          ((action: Action) =>
            action.type === "SET_BUSY_BLOCKING_INFO_ACTION" &&
            !action.value.isBusy) as ActionPattern,
        );
      }

      console.log("Retrying updateHdf5...");
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

  let jsonMappings: string[];
  let serverHdf5Mappings: string[];

  if (layerInfo.tracingId != null && layerInfo.fallbackLayer == null) {
    // The layer is a volume tracing without fallback layer. No mappings
    // exist for these kind of layers and should not be requested from the server.
    jsonMappings = [];
    serverHdf5Mappings = [];
  } else {
    const params = [
      dataset.dataStore.url,
      dataset, // If there is a fallbackLayer, request mappings for that instead of the tracing segmentation layer
      "fallbackLayer" in layerInfo && layerInfo.fallbackLayer != null
        ? layerInfo.fallbackLayer
        : layerInfo.name,
    ] as const;
    [jsonMappings, serverHdf5Mappings] = yield* all([
      call(getMappingsForDatasetLayer, ...params),
      call(getAgglomeratesForDatasetLayer, ...params),
    ]);
  }

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

  const visibleSegmentationLayerName = yield* select(
    (state) => getVisibleSegmentationLayer(state)?.name,
  );
  if (showLoadingIndicator && layerName === visibleSegmentationLayerName) {
    // Only show the message if the mapping belongs to the currently visible
    // segmentation layer. Otherwise, the message would stay as long as the
    // actual layer not visible.
    message.loading({
      content: "Activating Mapping",
      key: MAPPING_MESSAGE_KEY,
      duration: 0,
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
    yield* call(handleSetJsonMapping, layerName, mappingName, mappingType);
  } else if (mappingType === "HDF5") {
    yield* call(
      handleSetHdf5Mapping,
      layerName,
      layerInfo,
      mappingName,
      action,
      oldActiveMappingByLayer,
    );
  }
}

function* handleSetHdf5Mapping(
  layerName: string,
  layerInfo: APIDataLayer,
  mappingName: string,
  action: SetMappingAction,
  oldActiveMappingByLayer: Container<Record<string, ActiveMappingInfo>>,
): Saga<void> {
  if (yield* select((state) => getNeedsLocalHdf5Mapping(state, layerName))) {
    yield* call(updateLocalHdf5Mapping, layerName, layerInfo, mappingName);
  } else {
    // An HDF5 mapping was set that is applied remotely. A reload is necessary.
    yield* call(reloadData, oldActiveMappingByLayer, action);
  }
}

export function* updateLocalHdf5Mapping(
  layerName: string,
  layerInfo: APIDataLayer,
  mappingName: string,
): Saga<void> {
  const dataset = yield* select((state) => state.dataset);
  const annotation = yield* select((state) => state.annotation);
  // If there is a fallbackLayer, request mappings for that instead of the tracing segmentation layer
  const mappingLayerName =
    "fallbackLayer" in layerInfo && layerInfo.fallbackLayer != null
      ? layerInfo.fallbackLayer
      : layerName;

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

  const {
    aWithoutB: newSegmentIds,
    bWithoutA: deletedValues,
    // The `intersection` value returned by diffSetAndMap
    // is a fresh Map instance which is why we may mutate
    // that without any problems. This is done later to
    // avoid duplicating data for performance reasons.
    intersection: mutableRemainingEntries,
  } = fastDiffSetAndMap(segmentIds as Set<NumberLike>, previousMapping);

  const newEntries =
    editableMapping != null
      ? yield* call(
          getAgglomeratesForSegmentsFromTracingstore,
          annotation.tracingStore.url,
          editableMapping.tracingId,
          Array.from(newSegmentIds),
          annotation.annotationId,
          annotation.version,
        )
      : yield* call(
          getAgglomeratesForSegmentsFromDatastore,
          dataset.dataStore.url,
          dataset,
          mappingLayerName,
          mappingName,
          Array.from(newSegmentIds),
        );

  // It is safe to mutate mutableRemainingEntries to compute the merged,
  // new mapping. See the definition of mutableRemainingEntries.
  const mapping = mutableRemainingEntries as Mapping;
  for (const [key, val] of newEntries.entries()) {
    // @ts-ignore
    mapping.set(key, val);
  }

  setCacheResultForDiffMappings(previousMapping, mapping, {
    changed: [],
    onlyA: deletedValues,
    onlyB: newSegmentIds,
  });

  yield* put(setMappingAction(layerName, mappingName, "HDF5", { mapping }));
  if (process.env.IS_TESTING) {
    // in test context, the mapping.ts code is not executed (which is usually responsible
    // for finishing the initialization).
    yield put(finishMappingInitializationAction(layerName));
  }
}

function* handleSetJsonMapping(
  layerName: string,
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

  console.timeEnd("MappingSaga JSON");
  yield* put(setMappingAction(layerName, mappingName, mappingType, mappingProperties));
}

function convertMappingObjectToEquivalenceClasses(existingMapping: Mapping) {
  const classesByRepresentative: Record<number, number[]> = {};
  for (let [unmapped, mapped] of existingMapping.entries()) {
    // TODO: Proper 64 bit support (#6921)
    unmapped = Number(unmapped);
    mapped = Number(mapped);
    classesByRepresentative[mapped] = classesByRepresentative[mapped] || [];
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
    // TODO: Proper 64 bit support (#6921)
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
    state.annotation.volumes
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
