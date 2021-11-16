// @flow
import _ from "lodash";

import type {
  APIAnnotation,
  APIDatasetId,
  APIDataset,
  MutableAPIDataset,
  APIDataLayer,
  HybridServerTracing,
  ServerVolumeTracing,
} from "types/api_flow_types";
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
  getDataLayers,
  getDatasetCenter,
  getResolutionUnion,
  hasSegmentation,
  isElementClassSupported,
  getSegmentationLayers,
  getSegmentationLayerByNameOrFallbackName,
} from "oxalis/model/accessors/dataset_accessor";
import { getSomeServerTracing } from "oxalis/model/accessors/tracing_accessor";
import {
  getTracingForAnnotations,
  getAnnotationInformation,
  getEmptySandboxAnnotationInformation,
  getDataset,
  getSharingToken,
  getUserConfiguration,
  getDatasetViewConfiguration,
} from "admin/admin_rest_api";
import { initializeAnnotationAction } from "oxalis/model/actions/annotation_actions";
import { setToolAction } from "oxalis/model/actions/ui_actions";
import {
  initializeSettingsAction,
  initializeGpuSetupAction,
  setControlModeAction,
  setViewModeAction,
  setMappingAction,
} from "oxalis/model/actions/settings_actions";
import { initializeVolumeTracingAction } from "oxalis/model/actions/volumetracing_actions";
import { serverTracingAsSkeletonTracingMaybe } from "oxalis/model/accessors/skeletontracing_accessor";
import { serverTracingAsVolumeTracingMaybe } from "oxalis/model/accessors/volumetracing_accessor";
import {
  setActiveNodeAction,
  initializeSkeletonTracingAction,
  loadAgglomerateSkeletonAction,
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
import UrlManager, {
  type PartialUrlManagerState,
  type UrlStateByLayer,
} from "oxalis/controller/url_manager";
import * as Utils from "libs/utils";
import constants, { ControlModeEnum, AnnotationToolEnum } from "oxalis/constants";
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
  } else if (initialCommandType.type === ControlModeEnum.SANDBOX) {
    const { name, owningOrganization } = initialCommandType;
    datasetId = { name, owningOrganization };
    annotation = await getEmptySandboxAnnotationInformation(
      datasetId,
      initialCommandType.tracingType,
      getSharingToken(),
    );
  } else {
    const { name, owningOrganization } = initialCommandType;
    datasetId = { name, owningOrganization };
  }

  const [dataset, initialUserSettings, tracing] = await fetchParallel(
    annotation,
    datasetId,
    versions,
  );
  const displayedVolumeTracings = [];
  if (tracing != null && tracing.volume != null) {
    displayedVolumeTracings.push(tracing.volume.id);
  }

  initializeDataset(initialFetch, dataset, tracing);

  const initialDatasetSettings = await getDatasetViewConfiguration(
    dataset,
    displayedVolumeTracings,
    getSharingToken(),
  );
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

  if (initialFetch) {
    setInitialTool();
  }

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

function validateSpecsForLayers(dataset: APIDataset, requiredBucketCapacity: number): * {
  const layers = dataset.dataSource.dataLayers;
  const specs = getSupportedTextureSpecs();
  validateMinimumRequirements(specs);

  const setupDetails = computeDataTexturesSetup(
    specs,
    layers,
    layer => getBitDepth(layer) >> 3,
    hasSegmentation(dataset),
    requiredBucketCapacity,
  );

  if (!setupDetails.isMappingSupported) {
    console.warn(messages["mapping.too_few_textures"]);
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
  if (controlMode !== ControlModeEnum.VIEW) {
    if (controlMode === ControlModeEnum.SANDBOX) {
      annotation = {
        ...annotation,
        restrictions: {
          ...annotation.restrictions,
          allowUpdate: true,
          allowSave: false,
        },
      };
    } else if (controlMode === ControlModeEnum.TRACE) {
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
        getSegmentationLayers(dataset).length > 0,
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

function setInitialTool() {
  const { useLegacyBindings } = Store.getState().userConfiguration;

  if (!useLegacyBindings) {
    // The MOVE tool is already the default
    return;
  }

  const { tracing } = Store.getState();

  if (tracing.skeleton != null) {
    // We are in a annotation which contains a skeleton. Due to the
    // enabled legacy-bindings, the user can expect to immediately create new nodes
    // with right click. Therefore, switch to the skeleton tool.
    Store.dispatch(setToolAction(AnnotationToolEnum.SKELETON));
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

  const mutableDataset = ((dataset: any): MutableAPIDataset);
  // Add the originalElementClass property to the segmentation layer if it exists.
  // Also set the elementClass to uint32 because uint64 segmentation data is truncated to uint32 by the backend.
  const updatedDataLayers = mutableDataset.dataSource.dataLayers.map(dataLayer => {
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
  mutableDataset.dataSource.dataLayers = updatedDataLayers;

  serverTracingAsVolumeTracingMaybe(tracing).map(volumeTracing => {
    const newDataLayers = setupLayerForVolumeTracing(dataset, volumeTracing);
    mutableDataset.dataSource.dataLayers = newDataLayers;
  });

  ensureMatchingLayerResolutions(mutableDataset);
  Store.dispatch(setDatasetAction((mutableDataset: APIDataset)));
}

export function ensureMatchingLayerResolutions(dataset: APIDataset): void {
  try {
    getResolutionUnion(dataset, true);
  } catch (exception) {
    console.warn(exception);
    Toast.error(messages["dataset.resolution_mismatch"], { sticky: true });
  }
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

  const requiredBucketCapacity =
    constants.GPU_FACTOR_MULTIPLIER *
    (gpuFactor != null ? gpuFactor : constants.DEFAULT_GPU_MEMORY_FACTOR);

  const {
    textureInformationPerLayer,
    isMappingSupported,
    smallestCommonBucketCapacity,
    maximumLayerCountToRender,
    maximumTextureCountForLayer,
  } = validateSpecsForLayers(dataset, requiredBucketCapacity);

  if (process.env.BABEL_ENV !== "test") {
    console.log("Supporting", smallestCommonBucketCapacity, "buckets");
  }

  const connectionInfo = new ConnectionInfo();
  const layers = dataset.dataSource.dataLayers;
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

  if (hasSegmentation(dataset) != null && isMappingSupported) {
    window.mappings = setupGlobalMappingsObject();
  }

  if (getDataLayers(dataset).length === 0) {
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
  // 1) The volume layer should not be based on an existing layer. In that case, fallbackLayer is undefined
  //    and a new layer is created and added.
  // 2) The volume layer should be based on a fallback layer. In that case, merge the original fallbackLayer
  //    with the new volume layer.
  const fallbackLayerIndex = _.findIndex(layers, layer => layer.name === tracing.fallbackLayer);
  const fallbackLayer = layers[fallbackLayerIndex];
  const boundaries = getBoundaries(dataset);

  const resolutions = tracing.resolutions || [];
  const tracingHasResolutionList = resolutions.length > 0;

  // Legacy tracings don't have the `tracing.resolutions` property
  // since they were created before WK started to maintain multiple resolution
  // in volume annotations. Therefore, this code falls back to mag (1, 1, 1) for
  // that case.
  const tracingResolutions = tracingHasResolutionList
    ? resolutions.map(({ x, y, z }) => [x, y, z])
    : [[1, 1, 1]];

  const tracingLayer = {
    name: tracing.id,
    elementClass: tracing.elementClass,
    category: "segmentation",
    largestSegmentId: tracing.largestSegmentId,
    boundingBox: convertBoundariesToBoundingBox(boundaries),
    resolutions: tracingResolutions,
    mappings: fallbackLayer != null && fallbackLayer.mappings != null ? fallbackLayer.mappings : [],
    // remember the name of the original layer, used to request mappings
    fallbackLayer: tracing.fallbackLayer,
    fallbackLayerInfo: fallbackLayer,
    isTracingLayer: true,
  };

  if (fallbackLayer != null) {
    // Replace the original tracing layer
    layers[fallbackLayerIndex] = tracingLayer;
  } else {
    // Remove other segmentation layers, since we are adding a new one.
    // This is a temporary workaround. Even though we support multiple segmentation
    // layers, we cannot render both at the same time. Hiding the existing segmentation
    // layer would be good, but this information is stored per dataset and not per annotation
    // currently. Also, see https://github.com/scalableminds/webknossos/issues/5695
    layers = layers.filter(layer => layer.category !== "segmentation");
    layers.push(tracingLayer);
  }
  return layers;
}

function determineDefaultState(
  urlState: PartialUrlManagerState,
  tracing: ?HybridServerTracing,
): PartialUrlManagerState {
  const {
    position: urlStatePosition,
    zoomStep: urlStateZoomStep,
    rotation: urlStateRotation,
    activeNode: urlStateActiveNode,
    ...rest
  } = urlState;
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
  if (urlStatePosition != null) {
    position = urlStatePosition;
  }

  let zoomStep = datasetConfiguration.zoom;
  if (tracing != null) {
    zoomStep = getSomeServerTracing(tracing).zoomLevel;
  }
  if (urlStateZoomStep != null) {
    zoomStep = urlStateZoomStep;
  }

  let { rotation } = datasetConfiguration;
  if (tracing) {
    rotation = Utils.point3ToVector3(getSomeServerTracing(tracing).editRotation);
  }
  if (urlStateRotation != null) {
    rotation = urlStateRotation;
  }

  const activeNode = urlStateActiveNode;

  return { position, zoomStep, rotation, activeNode, ...rest };
}

export function applyState(state: PartialUrlManagerState, ignoreZoom: boolean = false) {
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
  if (state.stateByLayer != null) {
    applyLayerState(state.stateByLayer);
  }
}

function applyLayerState(stateByLayer: UrlStateByLayer) {
  for (const layerName of Object.keys(stateByLayer)) {
    const layerState = stateByLayer[layerName];

    if (layerState.mappingInfo != null) {
      const { mappingName, mappingType, agglomerateIdsToImport } = layerState.mappingInfo;

      let effectiveLayerName;
      try {
        const { dataset } = Store.getState();
        // The name of the layer could have changed if a volume tracing was created from a viewed annotation
        effectiveLayerName = getSegmentationLayerByNameOrFallbackName(dataset, layerName).name;
      } catch (e) {
        console.error(e);
        Toast.error(
          `URL configuration values for the layer "${layerName}" are ignored, because: ${
            e.message
          }`,
        );
        ErrorHandling.notify(e, { urlLayerState: stateByLayer });
        continue;
      }

      Store.dispatch(
        setMappingAction(effectiveLayerName, mappingName, mappingType, {
          showLoadingIndicator: true,
        }),
      );

      if (agglomerateIdsToImport != null) {
        const { tracing } = Store.getState();

        if (tracing.skeleton == null) {
          Toast.error(messages["tracing.agglomerate_skeleton.no_skeleton_tracing"]);
          continue;
        }

        if (mappingType !== "HDF5") {
          Toast.error(messages["tracing.agglomerate_skeleton.no_agglomerate_file"]);
          continue;
        }

        for (const agglomerateId of agglomerateIdsToImport) {
          Store.dispatch(
            loadAgglomerateSkeletonAction(effectiveLayerName, mappingName, agglomerateId),
          );
        }
      }
    }
  }
}
