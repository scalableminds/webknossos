// @flow
import _ from "lodash";

import type {
  APIAnnotation,
  APIDatasetId,
  APIDataset,
  APIDataLayer,
  HybridServerTracing,
  ServerVolumeTracing,
} from "admin/api_flow_types";
import {
  computeDataTexturesSetup,
  getSupportedTextureSpecs,
  validateMinimumRequirements,
} from "oxalis/model/bucket_data_handling/data_rendering_logic";
import type { Versions } from "oxalis/view/version_view";
import { convertBoundariesToBoundingBox } from "oxalis/model/reducers/reducer_helpers";
import {
  determineAllowedModes,
  getBitDepth,
  getBoundaries,
  getColorLayers,
  getDatasetCenter,
  getMostExtensiveResolutions,
  getSegmentationLayer,
  isElementClassSupported,
} from "oxalis/model/accessors/dataset_accessor";
import { getSomeServerTracing } from "oxalis/model/accessors/tracing_accessor";
import {
  getTracingForAnnotations,
  getAnnotationInformation,
  getDataset,
  getSharingToken,
  getUserConfiguration,
  getDatasetViewConfiguration,
} from "admin/admin_rest_api";
import { initializeAnnotationAction } from "oxalis/model/actions/annotation_actions";
import {
  initializeSettingsAction,
  initializeGpuSetupAction,
  setControlModeAction,
  setViewModeAction,
} from "oxalis/model/actions/settings_actions";
import { initializeVolumeTracingAction } from "oxalis/model/actions/volumetracing_actions";
import { serverTracingAsSkeletonTracingMaybe } from "oxalis/model/accessors/skeletontracing_accessor";
import { serverTracingAsVolumeTracingMaybe } from "oxalis/model/accessors/volumetracing_accessor";
import {
  setActiveNodeAction,
  initializeSkeletonTracingAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { setDatasetAction } from "oxalis/model/actions/dataset_actions";
import {
  setPositionAction,
  setZoomStepAction,
  setRotationAction,
} from "oxalis/model/actions/flycam_actions";
import { setTaskAction } from "oxalis/model/actions/task_actions";
import { setupGlobalMappingsObject } from "oxalis/model/bucket_data_handling/mappings";
import ConnectionInfo from "oxalis/model/data_connection_info";
import DataLayer from "oxalis/model/data_layer";
import ErrorHandling from "libs/error_handling";
import Store, { type TraceOrViewCommand, type AnnotationType } from "oxalis/store";
import Toast from "libs/toast";
import UrlManager, { type UrlManagerState } from "oxalis/controller/url_manager";
import * as Utils from "libs/utils";
import constants, { ControlModeEnum, type Vector3 } from "oxalis/constants";
import messages from "messages";
import window from "libs/window";

export const HANDLED_ERROR = "error_was_handled";

type DataLayerCollection = {
  [key: string]: DataLayer,
};

export async function initialize(
  annotationType: AnnotationType,
  initialCommandType: TraceOrViewCommand,
  initialFetch: boolean,
  versions?: Versions,
): Promise<?{
  dataLayers: DataLayerCollection,
  connectionInfo: ConnectionInfo,
  isMappingSupported: boolean,
  maximumTextureCountForLayer: number,
}> {
  Store.dispatch(setControlModeAction(initialCommandType.type));

  let annotation: APIAnnotation;
  let datasetId: APIDatasetId;
  if (initialCommandType.type === ControlModeEnum.TRACE) {
    const { annotationId } = initialCommandType;
    annotation = await getAnnotationInformation(annotationId, annotationType);
    datasetId = { name: annotation.dataSetName, owningOrganization: annotation.organization };

    if (!annotation.restrictions.allowAccess) {
      Toast.error(messages["tracing.no_access"]);
      throw HANDLED_ERROR;
    }

    ErrorHandling.assertExtendContext({
      task: annotation.id,
    });

    Store.dispatch(setTaskAction(annotation.task));
  } else {
    const { name, owningOrganization } = initialCommandType;
    datasetId = { name, owningOrganization };
  }

  const [dataset, initialUserSettings, tracing] = await fetchParallel(
    annotation,
    datasetId,
    versions,
  );

  let displayedLayers = [];
  if (dataset.dataSource.dataLayers != null) {
    displayedLayers = dataset.dataSource.dataLayers.map(layer => ({
      name: layer.name,
      isSegmentationLayer: layer.category !== "color",
    }));
  }

  if (tracing != null && tracing.volume != null) {
    if (tracing.volume.fallbackLayer == null) {
      displayedLayers = displayedLayers.filter(layer => !layer.isSegmentationLayer)
    }
    displayedLayers.push({ name: tracing.volume.id, isSegmentationLayer: true });
  }

  const initialDatasetSettings = await getDatasetViewConfiguration(dataset, displayedLayers);

  initializeDataset(initialFetch, dataset, tracing);
  initializeSettings(initialUserSettings, initialDatasetSettings);

  let initializationInformation = null;
  // There is no need to reinstantiate the DataLayers if the dataset didn't change.
  if (initialFetch) {
    const { gpuMemoryFactor } = initialUserSettings;
    initializationInformation = initializeDataLayerInstances(gpuMemoryFactor);
    if (tracing != null) Store.dispatch(setZoomStepAction(getSomeServerTracing(tracing).zoomLevel));
    const { smallestCommonBucketCapacity, maximumLayerCountToRender } = initializationInformation;
    Store.dispatch(
      initializeGpuSetupAction(
        smallestCommonBucketCapacity,
        gpuMemoryFactor,
        maximumLayerCountToRender,
      ),
    );
  }

  // There is no need to initialize the tracing if there is no tracing (View mode).
  if (annotation != null && tracing != null) {
    initializeTracing(annotation, tracing);
  } else {
    // In view only tracings we need to set the view mode too.
    const { allowedModes } = determineAllowedModes(dataset);
    const mode = UrlManager.initialState.mode || allowedModes[0];
    Store.dispatch(setViewModeAction(mode));
  }

  const defaultState = determineDefaultState(UrlManager.initialState, tracing);

  // Don't override zoom when swapping the task
  applyState(defaultState, !initialFetch);

  return initializationInformation;
}

async function fetchParallel(
  annotation: ?APIAnnotation,
  datasetId: APIDatasetId,
  versions?: Versions,
): Promise<[APIDataset, *, ?HybridServerTracing]> {
  // (Also see https://github.com/facebook/flow/issues/4936)
  // $FlowIssue[incompatible-return] Type inference with Promise.all seems to be a bit broken in flow
  return Promise.all([
    getDataset(datasetId, getSharingToken()),
    getUserConfiguration(),

    // Fetch the actual tracing from the datastore, if there is an skeletonAnnotation
    // $FlowIssue[incompatible-call] Type inference with Promise.all seems to be a bit broken in flow
    annotation ? getTracingForAnnotations(annotation, versions) : null,
  ]);
}

function validateSpecsForLayers(layers: Array<APIDataLayer>, requiredBucketCapacity: number): * {
  const specs = getSupportedTextureSpecs();
  validateMinimumRequirements(specs);

  const hasSegmentation = _.find(layers, layer => layer.category === "segmentation") != null;
  const setupDetails = computeDataTexturesSetup(
    specs,
    layers,
    layer => getBitDepth(layer) >> 3,
    hasSegmentation,
    requiredBucketCapacity,
  );

  if (!setupDetails.isMappingSupported) {
    const message = messages["mapping.too_few_textures"];
    console.warn(message);
  }

  maybeWarnAboutUnsupportedLayers(layers);

  return setupDetails;
}

function maybeWarnAboutUnsupportedLayers(layers: Array<APIDataLayer>): void {
  for (const layer of layers) {
    if (!isElementClassSupported(layer)) {
      Toast.warning(messages["dataset.unsupported_element_class"](layer.name, layer.elementClass), {
        sticky: true,
      });
    } else if (layer.category === "segmentation" && layer.elementClass === "uint24") {
      // Segmentation is not supported for uint24 layers
      Toast.error(messages["dataset.unsupported_segmentation_class"]);
    }
  }
}

function initializeTracing(_annotation: APIAnnotation, tracing: HybridServerTracing) {
  // This method is not called for the View mode
  const { dataset } = Store.getState();
  let annotation = _annotation;

  const { allowedModes, preferredMode } = determineAllowedModes(dataset, annotation.settings);
  _.extend(annotation.settings, { allowedModes, preferredMode });

  const { controlMode } = Store.getState().temporaryConfiguration;
  if (controlMode === ControlModeEnum.TRACE) {
    if (Utils.getUrlParamValue("sandbox")) {
      annotation = {
        ...annotation,
        restrictions: {
          ...annotation.restrictions,
          allowUpdate: true,
          allowSave: false,
        },
      };
    } else {
      annotation = {
        ...annotation,
        restrictions: {
          ...annotation.restrictions,
          allowSave: annotation.restrictions.allowUpdate,
        },
      };
    }

    // $FlowIssue[prop-missing] For some reason flow thinks the task property is missing, but it is not
    Store.dispatch(initializeAnnotationAction(annotation));

    serverTracingAsVolumeTracingMaybe(tracing).map(volumeTracing => {
      ErrorHandling.assert(
        getSegmentationLayer(dataset) != null,
        messages["tracing.volume_missing_segmentation"],
      );
      Store.dispatch(initializeVolumeTracingAction(volumeTracing));
    });

    serverTracingAsSkeletonTracingMaybe(tracing).map(skeletonTracing => {
      // To generate a huge amount of dummy trees, use:
      // import generateDummyTrees from "./model/helpers/generate_dummy_trees";
      // tracing.trees = generateDummyTrees(1, 200000);
      Store.dispatch(initializeSkeletonTracingAction(skeletonTracing));
    });
  }

  // Initialize 'flight', 'oblique' or 'orthogonal'/'volume' mode
  if (allowedModes.length === 0) {
    Toast.error(messages["tracing.no_allowed_mode"]);
  } else {
    const isHybridTracing = tracing.skeleton != null && tracing.volume != null;
    let maybeUrlViewMode = UrlManager.initialState.mode;
    if (isHybridTracing && UrlManager.initialState.mode === constants.MODE_VOLUME) {
      // Here we avoid going into volume mode in hybrid tracings.
      maybeUrlViewMode = constants.MODE_PLANE_TRACING;
    }
    const mode = preferredMode || maybeUrlViewMode || allowedModes[0];
    Store.dispatch(setViewModeAction(mode));
  }
}

function initializeDataset(
  initialFetch: boolean,
  dataset: APIDataset,
  tracing: ?HybridServerTracing,
): void {
  let error;
  if (!dataset) {
    error = messages["dataset.does_not_exist"];
  } else if (!dataset.dataSource.dataLayers) {
    error = `${messages["dataset.not_imported"]} '${dataset.name}'`;
  }

  if (error) {
    Toast.error(error);
    throw HANDLED_ERROR;
  }

  // Make sure subsequent fetch calls are always for the same dataset
  if (!initialFetch) {
    ErrorHandling.assert(
      _.isEqual(dataset.dataSource.id.name, Store.getState().dataset.name),
      messages["dataset.changed_without_reload"],
    );
  }

  ErrorHandling.assertExtendContext({
    dataSet: dataset.dataSource.id.name,
  });

  // Add the originalElementClass property to the segmentation layer if it exists.
  // Also set the elementClass to uint32 because uint64 segmentation data is truncated to uint32 by the backend.
  const updatedDataLayers = dataset.dataSource.dataLayers.map(dataLayer => {
    const { elementClass } = dataLayer;
    if (dataLayer.category === "segmentation") {
      const adjustedElementClass = elementClass === "uint64" ? "uint32" : elementClass;
      return {
        ...dataLayer,
        originalElementClass: elementClass,
        elementClass: adjustedElementClass,
      };
    } else {
      return dataLayer;
    }
  });
  // $FlowExpectedError[incompatible-use] assigning the adjusted dataset layers, although this property is not writable.
  dataset.dataSource.dataLayers = updatedDataLayers;

  serverTracingAsVolumeTracingMaybe(tracing).map(volumeTracing => {
    const newDataLayers = setupLayerForVolumeTracing(dataset, volumeTracing);
    // $FlowExpectedError[incompatible-use] We mutate the dataset here to avoid that an outdated version is used somewhere else
    dataset.dataSource.dataLayers = newDataLayers;
  });

  ensureDenseLayerResolutions(dataset);
  ensureMatchingLayerResolutions(dataset);
  Store.dispatch(setDatasetAction(dataset));
}

export function ensureDenseLayerResolutions(dataset: APIDataset) {
  const mostExtensiveResolutions = convertToDenseResolution(getMostExtensiveResolutions(dataset));
  for (const layer of dataset.dataSource.dataLayers) {
    layer.resolutions = convertToDenseResolution(layer.resolutions, mostExtensiveResolutions);
  }
}

export function ensureMatchingLayerResolutions(dataset: APIDataset): void {
  const mostExtensiveResolutions = getMostExtensiveResolutions(dataset);
  for (const layer of dataset.dataSource.dataLayers) {
    for (const resolution of layer.resolutions) {
      if (mostExtensiveResolutions.find(element => _.isEqual(resolution, element)) == null) {
        Toast.error(messages["dataset.resolution_mismatch"], { sticky: true });
      }
    }
  }
}

export function convertToDenseResolution(
  resolutions: Array<Vector3>,
  fallbackDenseResolutions?: Array<Vector3>,
): Array<Vector3> {
  // Each resolution entry can be characterized by it's greatest resolution dimension.
  // E.g., the resolution array [[1, 1, 1], [2, 2, 1], [4, 4, 2]] defines that
  // a log zoomstep of 2 corresponds to the resolution [2, 2, 1] (and not [4, 4, 2]).
  // Therefore, the largest dim for each resolution has to be unique across all resolutions.

  // This function returns an array of resolutions, for which each index will
  // hold a resolution with highest_dim === 2**index.

  if (resolutions.length !== _.uniqBy(resolutions.map(_.max)).length) {
    throw new Error("Max dimension in resolutions is not unique.");
  }
  const paddedResolutionCount = 1 + Math.log2(_.max(resolutions.map(v => _.max(v))));
  const resolutionsLookUp = _.keyBy(resolutions, _.max);
  const fallbackResolutionsLookUp = _.keyBy(fallbackDenseResolutions || [], _.max);

  return _.range(0, paddedResolutionCount).map(exp => {
    const resPower = 2 ** exp;
    // If the resolution does not exist, use either the given fallback resolution or an isotropic fallback
    const fallback = fallbackResolutionsLookUp[resPower] || [resPower, resPower, resPower];
    return resolutionsLookUp[resPower] || fallback;
  });
}

function initializeSettings(initialUserSettings: Object, initialDatasetSettings: Object): void {
  Store.dispatch(initializeSettingsAction(initialUserSettings, initialDatasetSettings));
}

function initializeDataLayerInstances(
  gpuFactor: ?number,
): {
  dataLayers: DataLayerCollection,
  connectionInfo: ConnectionInfo,
  isMappingSupported: boolean,
  maximumTextureCountForLayer: number,
  smallestCommonBucketCapacity: number,
  maximumLayerCountToRender: number,
} {
  const { dataset } = Store.getState();
  const layers = dataset.dataSource.dataLayers;

  const requiredBucketCapacity =
    constants.GPU_FACTOR_MULTIPLIER *
    (gpuFactor != null ? gpuFactor : constants.DEFAULT_GPU_MEMORY_FACTOR);

  const {
    textureInformationPerLayer,
    isMappingSupported,
    smallestCommonBucketCapacity,
    maximumLayerCountToRender,
    maximumTextureCountForLayer,
  } = validateSpecsForLayers(layers, requiredBucketCapacity);

  console.log("Supporting", smallestCommonBucketCapacity, "buckets");

  const connectionInfo = new ConnectionInfo();
  const dataLayers = {};
  for (const layer of layers) {
    const textureInformation = textureInformationPerLayer.get(layer);
    if (!textureInformation) {
      throw new Error("No texture information for layer?");
    }
    dataLayers[layer.name] = new DataLayer(
      layer,
      connectionInfo,
      textureInformation.textureSize,
      textureInformation.textureCount,
    );
  }

  const segmentationLayer = getSegmentationLayer(dataset);
  if (segmentationLayer != null && isMappingSupported) {
    window.mappings = setupGlobalMappingsObject(dataLayers[segmentationLayer.name]);
  }

  if (getColorLayers(dataset).length === 0 && segmentationLayer == null) {
    Toast.error(messages["dataset.no_data"]);
    throw HANDLED_ERROR;
  }

  return {
    dataLayers,
    connectionInfo,
    isMappingSupported,
    maximumTextureCountForLayer,
    smallestCommonBucketCapacity,
    maximumLayerCountToRender,
  };
}

function setupLayerForVolumeTracing(
  dataset: APIDataset,
  tracing: ServerVolumeTracing,
): Array<APIDataLayer> {
  // This method adds/merges the segmentation layers of the tracing into the dataset layers
  let layers = _.clone(dataset.dataSource.dataLayers);

  // The tracing always contains the layer information for the user segmentation.
  // Two possible cases:
  // 1) No segmentation exists yet: In that case layers doesn't contain the dataLayer - it needs
  //    to be created and inserted.
  // 2) Segmentation exists: In that case layers already contains dataLayer and the fallbackLayer
  //    property specifies its name, to be able to merge the two layers
  const fallbackLayerIndex = _.findIndex(layers, layer => layer.name === tracing.fallbackLayer);
  const fallbackLayer = layers[fallbackLayerIndex];
  const boundaries = getBoundaries(dataset);

  const tracingLayer = {
    name: tracing.id,
    elementClass: tracing.elementClass,
    category: "segmentation",
    largestSegmentId: tracing.largestSegmentId,
    boundingBox: convertBoundariesToBoundingBox(boundaries),
    // volume tracing can only be done for the first resolution
    resolutions: [[1, 1, 1]],
    mappings: fallbackLayer != null && fallbackLayer.mappings != null ? fallbackLayer.mappings : [],
    // remember the name of the original layer, used to request mappings
    fallbackLayer: tracing.fallbackLayer,
  };

  if (fallbackLayer != null) {
    // Replace the orginal tracing layer
    layers[fallbackLayerIndex] = tracingLayer;
  } else {
    // Remove other segmentation layers, since we are adding a new one.
    // This is a temporary workaround. In the long term we want to support
    // multiple segmentation layers.
    layers = layers.filter(layer => layer.category !== "segmentation");
    layers.push(tracingLayer);
  }
  return layers;
}

function determineDefaultState(
  urlState: UrlManagerState,
  tracing: ?HybridServerTracing,
): $Shape<UrlManagerState> {
  // If there is no editPosition (e.g. when viewing a dataset) and
  // no default position, compute the center of the dataset
  const { dataset, datasetConfiguration } = Store.getState();
  const defaultPosition = datasetConfiguration.position;
  let position = getDatasetCenter(dataset);
  if (defaultPosition != null) {
    position = defaultPosition;
  }
  if (tracing != null) {
    position = Utils.point3ToVector3(getSomeServerTracing(tracing).editPosition);
  }
  if (urlState.position != null) {
    ({ position } = urlState);
  }

  let zoomStep = datasetConfiguration.zoom;
  if (tracing != null) {
    zoomStep = getSomeServerTracing(tracing).zoomLevel;
  }
  if (urlState.zoomStep != null) {
    ({ zoomStep } = urlState);
  }

  let { rotation } = datasetConfiguration;
  if (tracing) {
    rotation = Utils.point3ToVector3(getSomeServerTracing(tracing).editRotation);
  }
  if (urlState.rotation != null) {
    ({ rotation } = urlState);
  }

  const { activeNode } = urlState;

  return { position, zoomStep, rotation, activeNode };
}

export function applyState(state: $Shape<UrlManagerState>, ignoreZoom: boolean = false) {
  if (state.activeNode != null) {
    // Set the active node (without animating to its position) before setting the
    // position, since the position should take precedence.
    Store.dispatch(setActiveNodeAction(state.activeNode, true));
  }
  if (state.position != null) {
    Store.dispatch(setPositionAction(state.position));
  }
  if (!ignoreZoom && state.zoomStep != null) {
    Store.dispatch(setZoomStepAction(state.zoomStep));
  }
  if (state.rotation != null) {
    Store.dispatch(setRotationAction(state.rotation));
  }
}
