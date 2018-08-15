// @flow
import _ from "lodash";
import Store, { type UserConfigurationType, type DatasetConfigurationType } from "oxalis/store";
import type { TracingTypeTracingType } from "oxalis/store";
import type { UrlManagerState } from "oxalis/controller/url_manager";
import {
  setDatasetAction,
  setViewModeAction,
  setControlModeAction,
  initializeSettingsAction,
} from "oxalis/model/actions/settings_actions";
import { initializeAnnotationAction } from "oxalis/model/actions/annotation_actions";
import {
  setActiveNodeAction,
  initializeSkeletonTracingAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { getSomeServerTracing } from "oxalis/model/accessors/tracing_accessor";
import { initializeVolumeTracingAction } from "oxalis/model/actions/volumetracing_actions";
import { setTaskAction } from "oxalis/model/actions/task_actions";
import {
  setPositionAction,
  setZoomStepAction,
  setRotationAction,
} from "oxalis/model/actions/flycam_actions";
import window from "libs/window";
import Utils from "libs/utils";
import DataLayer from "oxalis/model/data_layer";
import ConnectionInfo from "oxalis/model/data_connection_info";
import { ControlModeEnum } from "oxalis/constants";
import type { ControlModeType } from "oxalis/constants";
import Toast from "libs/toast";
import ErrorHandling from "libs/error_handling";
import UrlManager from "oxalis/controller/url_manager";
import {
  getTracingForAnnotations,
  getAnnotationInformation,
  getDataset,
  getSharingToken,
  getUserConfiguration,
  getDatasetConfiguration,
} from "admin/admin_rest_api";
import messages from "messages";
import type {
  APIAnnotationType,
  APIDatasetType,
  APIDataLayerType,
  HybridServerTracingType,
  ServerVolumeTracingType,
} from "admin/api_flow_types";
import {
  getDatasetCenter,
  determineAllowedModes,
  getBitDepth,
  getSegmentationLayer,
  getColorLayers,
} from "oxalis/model/accessors/dataset_accessor";
import { serverTracingAsVolumeTracingMaybe } from "oxalis/model/accessors/volumetracing_accessor";
import { serverTracingAsSkeletonTracingMaybe } from "oxalis/model/accessors/skeletontracing_accessor";
import { convertPointToVecInBoundingBox } from "oxalis/model/reducers/reducer_helpers";
import { setupGlobalMappingsObject } from "oxalis/model/bucket_data_handling/mappings";
import type { DataTextureSizeAndCount } from "./model/bucket_data_handling/data_rendering_logic";
import * as DataRenderingLogic from "./model/bucket_data_handling/data_rendering_logic";

export const HANDLED_ERROR = "error_was_handled";

type DataLayerCollection = {
  [key: string]: DataLayer,
};

export async function initialize(
  tracingType: TracingTypeTracingType,
  annotationIdOrDatasetName: string,
  controlMode: ControlModeType,
  initialFetch: boolean,
): Promise<?{
  dataLayers: DataLayerCollection,
  connectionInfo: ConnectionInfo,
  isMappingSupported: boolean,
  maximumDataTextureCountForLayer: number,
}> {
  Store.dispatch(setControlModeAction(controlMode));

  let annotation: APIAnnotationType;
  let datasetName;
  if (controlMode === ControlModeEnum.TRACE) {
    const annotationId = annotationIdOrDatasetName;
    annotation = await getAnnotationInformation(annotationId, tracingType);
    datasetName = annotation.dataSetName;

    if (!annotation.restrictions.allowAccess) {
      Toast.error(messages["tracing.no_access"]);
      throw HANDLED_ERROR;
    }

    ErrorHandling.assertExtendContext({
      task: annotation.id,
    });

    Store.dispatch(setTaskAction(annotation.task));
  } else {
    // In View mode, the annotationId is actually the datasetName
    // as there is no annotation and no tracing!
    datasetName = annotationIdOrDatasetName;
  }

  const [dataset, initialUserSettings, initialDatasetSettings, tracing] = await fetchParallel(
    annotation,
    datasetName,
  );

  initializeDataset(initialFetch, dataset, tracing);
  initializeSettings(initialUserSettings, initialDatasetSettings);

  let initializationInformation = null;
  // There is no need to reinstantiate the DataLayers if the dataset didn't change.
  if (initialFetch) {
    initializationInformation = initializeDataLayerInstances();
    if (tracing != null) Store.dispatch(setZoomStepAction(getSomeServerTracing(tracing).zoomLevel));
  }

  // There is no need to initialize the tracing if there is no tracing (View mode).
  if (annotation != null && tracing != null) {
    initializeTracing(annotation, tracing);
  }

  const defaultState = determineDefaultState(UrlManager.initialState, tracing);
  applyState(defaultState);

  return initializationInformation;
}

async function fetchParallel(
  annotation: ?APIAnnotationType,
  datasetName: string,
): Promise<
  [APIDatasetType, UserConfigurationType, DatasetConfigurationType, ?HybridServerTracingType],
> {
  return Promise.all([
    getDataset(datasetName, getSharingToken()),
    getUserConfiguration(),
    getDatasetConfiguration(datasetName),
    // Fetch the actual tracing from the datastore, if there is an skeletonAnnotation
    // (Also see https://github.com/facebook/flow/issues/4936)
    // $FlowFixMe: Type inference with Promise.all seems to be a bit broken in flow
    annotation ? getTracingForAnnotations(annotation) : null,
  ]);
}

function validateSpecsForLayers(
  layers: Array<APIDataLayerType>,
): {
  textureInformationPerLayer: Map<APIDataLayerType, DataTextureSizeAndCount>,
  isMappingSupported: boolean,
} {
  const specs = DataRenderingLogic.getSupportedTextureSpecs();
  DataRenderingLogic.validateMinimumRequirements(specs);

  const hasSegmentation = _.find(layers, layer => layer.category === "segmentation") != null;
  const {
    isMappingSupported,
    textureInformationPerLayer,
    isBasicRenderingSupported,
  } = DataRenderingLogic.computeDataTexturesSetup(
    specs,
    layers,
    layer => getBitDepth(layer) >> 3,
    hasSegmentation,
  );

  if (!isBasicRenderingSupported) {
    const message = `Not enough textures available for rendering ${layers.length} layers`;
    Toast.error(message);
    throw new Error(message);
  }

  if (!isMappingSupported) {
    const message = messages["mapping.too_few_textures"];
    console.warn(message);
  }

  return { isMappingSupported, textureInformationPerLayer };
}

function initializeTracing(annotation: APIAnnotationType, tracing: HybridServerTracingType) {
  // This method is not called for the View mode
  const { dataset } = Store.getState();

  const { allowedModes, preferredMode } = determineAllowedModes(dataset, annotation.settings);
  _.extend(annotation.settings, { allowedModes, preferredMode });

  const { controlMode } = Store.getState().temporaryConfiguration;
  if (controlMode === ControlModeEnum.TRACE) {
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
    const mode = preferredMode || UrlManager.initialState.mode || allowedModes[0];
    Store.dispatch(setViewModeAction(mode));
  }
}

function initializeDataset(
  initialFetch: boolean,
  dataset: APIDatasetType,
  tracing: ?HybridServerTracingType,
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

  serverTracingAsVolumeTracingMaybe(tracing).map(volumeTracing => {
    const newDataLayers = setupLayerForVolumeTracing(dataset.dataSource.dataLayers, volumeTracing);
    // $FlowFixMe We mutate the dataset here to avoid that an outdated version is used somewhere else
    dataset.dataSource.dataLayers = newDataLayers;
  });

  Store.dispatch(setDatasetAction(dataset));
}

function initializeSettings(initialUserSettings: Object, initialDatasetSettings: Object): void {
  Store.dispatch(initializeSettingsAction(initialUserSettings, initialDatasetSettings));
}

function initializeDataLayerInstances(): {
  dataLayers: DataLayerCollection,
  connectionInfo: ConnectionInfo,
  isMappingSupported: boolean,
  maximumDataTextureCountForLayer: number,
} {
  const { dataset } = Store.getState();
  const layers = dataset.dataSource.dataLayers;

  const { textureInformationPerLayer, isMappingSupported } = validateSpecsForLayers(layers);
  const maximumDataTextureCountForLayer = _.max(
    Array.from(textureInformationPerLayer.values()).map(info => info.textureCount),
  );

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

  if (getColorLayers(dataset).length === 0) {
    Toast.error(messages["dataset.no_data"]);
    throw HANDLED_ERROR;
  }

  return { dataLayers, connectionInfo, isMappingSupported, maximumDataTextureCountForLayer };
}

function setupLayerForVolumeTracing(
  _layers: APIDataLayerType[],
  tracing: ServerVolumeTracingType,
): Array<APIDataLayerType> {
  // This method adds/merges the segmentation layers of the tracing into the dataset layers
  let layers = _.clone(_layers);

  // The tracing always contains the layer information for the user segmentation.
  // Two possible cases:
  // 1) No segmentation exists yet: In that case layers doesn't contain the dataLayer - it needs
  //    to be created and inserted.
  // 2) Segmentation exists: In that case layers already contains dataLayer and the fallbackLayer
  //    property specifies its name, to be able to merge the two layers
  const fallbackLayerIndex = _.findIndex(layers, layer => layer.name === tracing.fallbackLayer);
  const fallbackLayer = layers[fallbackLayerIndex];

  const tracingLayer = {
    name: tracing.id,
    elementClass: tracing.elementClass,
    category: "segmentation",
    largestSegmentId: tracing.largestSegmentId,
    boundingBox: convertPointToVecInBoundingBox(tracing.boundingBox),
    // volume tracing can only be done for the first resolution
    resolutions: [[1, 1, 1]],
    mappings: fallbackLayer != null && fallbackLayer.mappings != null ? fallbackLayer.mappings : [],
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
  tracing: ?HybridServerTracingType,
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

export function applyState(state: $Shape<UrlManagerState>) {
  if (state.activeNode != null) {
    // Set the active node (without animating to its position) before setting the
    // position, since the position should take precedence.
    Store.dispatch(setActiveNodeAction(state.activeNode, true));
  }
  if (state.position != null) {
    Store.dispatch(setPositionAction(state.position));
  }
  if (state.zoomStep != null) {
    Store.dispatch(setZoomStepAction(state.zoomStep));
  }
  if (state.rotation != null) {
    Store.dispatch(setRotationAction(state.rotation));
  }
}
