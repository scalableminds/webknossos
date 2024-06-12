import _ from "lodash";
import type {
  APIAnnotation,
  APIDatasetId,
  APIDataset,
  MutableAPIDataset,
  APIDataLayer,
  ServerVolumeTracing,
  ServerTracing,
  ServerEditableMapping,
  APICompoundType,
  APISegmentationLayer,
} from "types/api_flow_types";
import type { Versions } from "oxalis/view/version_view";
import {
  computeDataTexturesSetup,
  getSupportedTextureSpecs,
  validateMinimumRequirements,
} from "oxalis/model/bucket_data_handling/data_rendering_logic";
import {
  determineAllowedModes,
  getBitDepth,
  getDatasetBoundingBox,
  getDataLayers,
  getDatasetCenter,
  hasSegmentation,
  isElementClassSupported,
  isSegmentationLayer,
  getSegmentationLayers,
  getLayerByName,
  getSegmentationLayerByName,
  getUnifiedAdditionalCoordinates,
} from "oxalis/model/accessors/dataset_accessor";
import { getNullableSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import { getServerVolumeTracings } from "oxalis/model/accessors/volumetracing_accessor";
import { getSomeServerTracing } from "oxalis/model/accessors/tracing_accessor";
import {
  getTracingsForAnnotation,
  getAnnotationInformation,
  getEmptySandboxAnnotationInformation,
  getDataset,
  getSharingTokenFromUrlParameters,
  getUserConfiguration,
  getDatasetViewConfiguration,
  getEditableMappingInfo,
  getAnnotationCompoundInformation,
} from "admin/admin_rest_api";
import {
  dispatchMaybeFetchMeshFilesAsync,
  initializeAnnotationAction,
  updateCurrentMeshFileAction,
} from "oxalis/model/actions/annotation_actions";
import {
  initializeSettingsAction,
  initializeGpuSetupAction,
  setControlModeAction,
  setViewModeAction,
  setMappingAction,
  updateLayerSettingAction,
  setMappingEnabledAction,
} from "oxalis/model/actions/settings_actions";
import {
  initializeEditableMappingAction,
  initializeVolumeTracingAction,
} from "oxalis/model/actions/volumetracing_actions";
import {
  setActiveNodeAction,
  initializeSkeletonTracingAction,
  loadAgglomerateSkeletonAction,
  setShowSkeletonsAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { setDatasetAction } from "oxalis/model/actions/dataset_actions";
import {
  setPositionAction,
  setZoomStepAction,
  setRotationAction,
  setAdditionalCoordinatesAction,
} from "oxalis/model/actions/flycam_actions";
import { setTaskAction } from "oxalis/model/actions/task_actions";
import { setToolAction } from "oxalis/model/actions/ui_actions";
import {
  loadAdHocMeshAction,
  loadPrecomputedMeshAction,
} from "oxalis/model/actions/segmentation_actions";
import DataLayer from "oxalis/model/data_layer";
import ErrorHandling from "libs/error_handling";
import type {
  DatasetConfiguration,
  DatasetLayerConfiguration,
  TraceOrViewCommand,
  UserConfiguration,
} from "oxalis/store";
import Store from "oxalis/store";
import Toast from "libs/toast";
import type { PartialUrlManagerState, UrlStateByLayer } from "oxalis/controller/url_manager";
import UrlManager from "oxalis/controller/url_manager";
import * as Utils from "libs/utils";
import constants, { ControlModeEnum, AnnotationToolEnum, Vector3 } from "oxalis/constants";
import messages from "messages";
import {
  setActiveConnectomeAgglomerateIdsAction,
  updateCurrentConnectomeFileAction,
} from "oxalis/model/actions/connectome_actions";
import {
  PricingPlanEnum,
  isFeatureAllowedByPricingPlan,
} from "admin/organization/pricing_plan_utils";
import { convertServerAdditionalAxesToFrontEnd } from "./model/reducers/reducer_helpers";

export const HANDLED_ERROR = "error_was_handled";
type DataLayerCollection = Record<string, DataLayer>;

export async function initialize(
  initialMaybeCompoundType: APICompoundType | null,
  initialCommandType: TraceOrViewCommand,
  initialFetch: boolean,
  versions?: Versions,
): Promise<
  | {
      dataLayers: DataLayerCollection;
      maximumTextureCountForLayer: number;
    }
  | null
  | undefined
> {
  Store.dispatch(setControlModeAction(initialCommandType.type));
  let annotation: APIAnnotation | null | undefined;
  let datasetId: APIDatasetId;

  if (initialCommandType.type === ControlModeEnum.TRACE) {
    const { annotationId } = initialCommandType;
    annotation =
      initialMaybeCompoundType != null
        ? await getAnnotationCompoundInformation(annotationId, initialMaybeCompoundType)
        : await getAnnotationInformation(annotationId);
    datasetId = {
      name: annotation.dataSetName,
      owningOrganization: annotation.organization,
    };

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
    datasetId = {
      name,
      owningOrganization,
    };
    annotation = await getEmptySandboxAnnotationInformation(
      datasetId,
      initialCommandType.tracingType,
      getSharingTokenFromUrlParameters(),
    );
  } else {
    const { name, owningOrganization } = initialCommandType;
    datasetId = {
      name,
      owningOrganization,
    };
  }

  const [dataset, initialUserSettings, serverTracings] = await fetchParallel(
    annotation,
    datasetId,
    versions,
  );
  const serverVolumeTracings = getServerVolumeTracings(serverTracings);
  const serverVolumeTracingIds = serverVolumeTracings.map((volumeTracing) => volumeTracing.id);
  initializeDataset(initialFetch, dataset, serverTracings);
  const initialDatasetSettings = await getDatasetViewConfiguration(
    dataset,
    serverVolumeTracingIds,
    getSharingTokenFromUrlParameters(),
  );
  const annotationSpecificDatasetSettings = applyAnnotationSpecificViewConfiguration(
    annotation,
    dataset,
    initialDatasetSettings,
  );
  const enforcedInitialUserSettings =
    enforcePricingRestrictionsOnUserConfiguration(initialUserSettings);
  initializeSettings(
    enforcedInitialUserSettings,
    annotationSpecificDatasetSettings,
    initialDatasetSettings,
  );
  let initializationInformation = null;

  // There is no need to reinstantiate the DataLayers if the dataset didn't change.
  if (initialFetch) {
    const { gpuMemoryFactor } = Store.getState().userConfiguration;
    initializationInformation = initializeDataLayerInstances(gpuMemoryFactor);
    if (serverTracings.length > 0)
      Store.dispatch(setZoomStepAction(getSomeServerTracing(serverTracings).zoomLevel));
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
  if (annotation != null) {
    const editableMappings = await fetchEditableMappings(
      annotation.tracingStore.url,
      serverVolumeTracings,
    );
    initializeTracing(annotation, serverTracings, editableMappings);
  } else {
    // In view only tracings we need to set the view mode too.
    const { allowedModes } = determineAllowedModes();
    const mode = UrlManager.initialState.mode || allowedModes[0];
    Store.dispatch(setViewModeAction(mode));
  }

  const defaultState = determineDefaultState(UrlManager.initialState, serverTracings);
  // Don't override zoom when swapping the task
  applyState(defaultState, !initialFetch);

  if (initialFetch) {
    setInitialTool();
  }

  return initializationInformation;
}

async function fetchParallel(
  annotation: APIAnnotation | null | undefined,
  datasetId: APIDatasetId,
  versions?: Versions,
): Promise<[APIDataset, UserConfiguration, Array<ServerTracing>]> {
  return Promise.all([
    getDataset(datasetId, getSharingTokenFromUrlParameters()),
    getUserConfiguration(), // Fetch the actual tracing from the datastore, if there is an skeletonAnnotation
    annotation ? getTracingsForAnnotation(annotation, versions) : [],
  ]);
}

async function fetchEditableMappings(
  tracingStoreUrl: string,
  serverVolumeTracings: ServerVolumeTracing[],
): Promise<ServerEditableMapping[]> {
  const promises = serverVolumeTracings
    .filter((tracing) => tracing.mappingIsEditable)
    .map((tracing) => getEditableMappingInfo(tracingStoreUrl, tracing.id));
  return Promise.all(promises);
}

function validateSpecsForLayers(dataset: APIDataset, requiredBucketCapacity: number): any {
  const layers = dataset.dataSource.dataLayers;
  const specs = getSupportedTextureSpecs();
  validateMinimumRequirements(specs);
  const setupDetails = computeDataTexturesSetup(
    specs,
    layers,
    (layer) => getBitDepth(layer) >> 3,
    hasSegmentation(dataset),
    requiredBucketCapacity,
  );

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
      Toast.error(messages["dataset.unsupported_segmentation_class_uint24"]);
    } else if (layer.category === "segmentation" && layer.elementClass === "int64") {
      Toast.error(messages["dataset.unsupported_segmentation_class_int64"]);
    }
  }
}

function initializeTracing(
  _annotation: APIAnnotation,
  serverTracings: Array<ServerTracing>,
  editableMappings: Array<ServerEditableMapping>,
) {
  // This method is not called for the View mode
  const { dataset } = Store.getState();
  let annotation = _annotation;
  const { allowedModes, preferredMode } = determineAllowedModes(annotation.settings);

  _.extend(annotation.settings, {
    allowedModes,
    preferredMode,
  });

  const { controlMode } = Store.getState().temporaryConfiguration;

  if (controlMode !== ControlModeEnum.VIEW) {
    if (controlMode === ControlModeEnum.SANDBOX) {
      annotation = {
        ...annotation,
        restrictions: { ...annotation.restrictions, allowUpdate: true, allowSave: false },
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

    Store.dispatch(initializeAnnotationAction(annotation));
    getServerVolumeTracings(serverTracings).map((volumeTracing) => {
      ErrorHandling.assert(
        getSegmentationLayers(dataset).length > 0,
        messages["tracing.volume_missing_segmentation"],
      );
      Store.dispatch(initializeVolumeTracingAction(volumeTracing));
    });

    editableMappings.map((mapping) => Store.dispatch(initializeEditableMappingAction(mapping)));

    const skeletonTracing = getNullableSkeletonTracing(serverTracings);

    if (skeletonTracing != null) {
      // To generate a huge amount of dummy trees, use:
      // import generateDummyTrees from "./model/helpers/generate_dummy_trees";
      // tracing.trees = generateDummyTrees(1, 200000);
      Store.dispatch(initializeSkeletonTracingAction(skeletonTracing));
    }
  }

  // Initialize 'flight', 'oblique' or 'orthogonal' mode
  if (allowedModes.length === 0) {
    Toast.error(messages["tracing.no_allowed_mode"]);
  } else {
    const maybeUrlViewMode = UrlManager.initialState.mode;
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
  serverTracings: Array<ServerTracing>,
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
  const mutableDataset = dataset as any as MutableAPIDataset;
  const volumeTracings = getServerVolumeTracings(serverTracings);

  if (volumeTracings.length > 0) {
    const newDataLayers = setupLayerForVolumeTracing(dataset, volumeTracings);
    mutableDataset.dataSource.dataLayers = newDataLayers;
    validateVolumeLayers(volumeTracings, newDataLayers);
  }

  Store.dispatch(setDatasetAction(mutableDataset as APIDataset));
  initializeAdditionalCoordinates(mutableDataset);
}

function initializeAdditionalCoordinates(mutableDataset: MutableAPIDataset) {
  const unifiedAdditionalCoordinates = getUnifiedAdditionalCoordinates(mutableDataset);
  const initialAdditionalCoordinates = Utils.values(unifiedAdditionalCoordinates).map(
    ({ name, bounds }) => ({ name, value: Math.floor((bounds[1] - bounds[0]) / 2) }),
  );

  Store.dispatch(setAdditionalCoordinatesAction(initialAdditionalCoordinates));
}

function initializeSettings(
  initialUserSettings: UserConfiguration,
  initialDatasetSettings: DatasetConfiguration,
  originalDatasetSettings: DatasetConfiguration,
): void {
  Store.dispatch(
    initializeSettingsAction(initialUserSettings, initialDatasetSettings, originalDatasetSettings),
  );
}

function initializeDataLayerInstances(gpuFactor: number | null | undefined): {
  dataLayers: DataLayerCollection;
  maximumTextureCountForLayer: number;
  smallestCommonBucketCapacity: number;
  maximumLayerCountToRender: number;
} {
  const { dataset } = Store.getState();
  const requiredBucketCapacity =
    constants.GPU_FACTOR_MULTIPLIER *
    (gpuFactor != null ? gpuFactor : constants.DEFAULT_GPU_MEMORY_FACTOR);
  const {
    textureInformationPerLayer,
    smallestCommonBucketCapacity,
    maximumLayerCountToRender,
    maximumTextureCountForLayer,
  } = validateSpecsForLayers(dataset, requiredBucketCapacity);

  if (!process.env.IS_TESTING) {
    console.log("Supporting", smallestCommonBucketCapacity, "buckets");
  }

  const layers = dataset.dataSource.dataLayers;
  const dataLayers: DataLayerCollection = {};

  for (const layer of layers) {
    const textureInformation = textureInformationPerLayer.get(layer);

    if (!textureInformation) {
      throw new Error("No texture information for layer?");
    }

    dataLayers[layer.name] = new DataLayer(
      layer,
      textureInformation.textureSize,
      textureInformation.textureCount,
    );
  }

  if (getDataLayers(dataset).length === 0) {
    Toast.error(messages["dataset.no_data"]);
    throw HANDLED_ERROR;
  }

  return {
    dataLayers,
    maximumTextureCountForLayer,
    smallestCommonBucketCapacity,
    maximumLayerCountToRender,
  };
}

function setupLayerForVolumeTracing(
  dataset: APIDataset,
  tracings: Array<ServerVolumeTracing>,
): Array<APIDataLayer> {
  // This method adds/merges the segmentation layers of the tracing into the dataset layers.

  const originalLayers = dataset.dataSource.dataLayers;
  const newLayers = originalLayers.slice();

  for (const tracing of tracings) {
    // The tracing always contains the layer information for the user segmentation.
    // Two possible cases:
    // 1) The volume layer should not be based on an existing layer. In that case, fallbackLayer is undefined
    //    and a new layer is created and added.
    // 2) The volume layer should be based on a fallback layer. In that case, merge the original fallbackLayer
    //    with the new volume layer.
    const fallbackLayerIndex = _.findIndex(
      originalLayers,
      (layer) => layer.name === tracing.fallbackLayer,
    );

    const fallbackLayer = fallbackLayerIndex > -1 ? originalLayers[fallbackLayerIndex] : null;
    const boundingBox = getDatasetBoundingBox(dataset).asServerBoundingBox();
    const resolutions = tracing.resolutions || [];
    const tracingHasResolutionList = resolutions.length > 0;
    // Legacy tracings don't have the `tracing.resolutions` property
    // since they were created before WK started to maintain multiple resolution
    // in volume annotations. Therefore, this code falls back to mag (1, 1, 1) for
    // that case.
    const tracingResolutions: Vector3[] = tracingHasResolutionList
      ? resolutions.map(({ x, y, z }) => [x, y, z])
      : [[1, 1, 1]];
    const tracingLayer: APISegmentationLayer = {
      name: tracing.id,
      tracingId: tracing.id,
      elementClass: tracing.elementClass,
      category: "segmentation",
      largestSegmentId: tracing.largestSegmentId,
      boundingBox,
      resolutions: tracingResolutions,
      mappings:
        fallbackLayer != null && "mappings" in fallbackLayer ? fallbackLayer.mappings : undefined,
      // Remember the name of the original layer (e.g., used to request mappings)
      fallbackLayer: tracing.fallbackLayer,
      fallbackLayerInfo: fallbackLayer,
      additionalAxes: convertServerAdditionalAxesToFrontEnd(tracing.additionalAxes),
    };
    if (fallbackLayerIndex > -1) {
      newLayers[fallbackLayerIndex] = tracingLayer;
    } else {
      newLayers.push(tracingLayer);
    }
  }

  return newLayers;
}

function validateVolumeLayers(
  volumeTracings: Array<ServerVolumeTracing>,
  dataLayers: Array<APIDataLayer>,
) {
  /*
   * Validate that every volume tracing got a corresponding data layer.
   */
  const layersForVolumeTracings = volumeTracings.map((volumeTracing) =>
    dataLayers.find(
      (layer) => layer.category === "segmentation" && layer.tracingId === volumeTracing.id,
    ),
  );

  if (layersForVolumeTracings.some((layer) => layer == null)) {
    throw new Error(
      "Initialization of volume tracing layers didn't succeed. Not all volume tracings have a corresponding data layer.",
    );
  }
}

function determineDefaultState(
  urlState: PartialUrlManagerState,
  tracings: Array<ServerTracing>,
): PartialUrlManagerState {
  const {
    position: urlStatePosition,
    additionalCoordinates: urlStateAdditionalCoordinates,
    zoomStep: urlStateZoomStep,
    rotation: urlStateRotation,
    activeNode: urlStateActiveNode,
    stateByLayer: urlStateByLayer,
    ...rest
  } = urlState;
  // If there is no editPosition (e.g. when viewing a dataset) and
  // no default position, compute the center of the dataset
  const { dataset, datasetConfiguration, temporaryConfiguration } = Store.getState();
  const { viewMode } = temporaryConfiguration;
  const defaultPosition = datasetConfiguration.position;
  let position = getDatasetCenter(dataset);
  let additionalCoordinates = null;

  if (defaultPosition != null) {
    position = defaultPosition;
  }

  const someTracing = tracings.length > 0 ? getSomeServerTracing(tracings) : null;

  if (someTracing != null) {
    position = Utils.point3ToVector3(someTracing.editPosition);
    additionalCoordinates = someTracing.editPositionAdditionalCoordinates;
  }

  if (urlStatePosition != null) {
    position = urlStatePosition;
  }

  if (urlStateAdditionalCoordinates != null) {
    additionalCoordinates = urlStateAdditionalCoordinates;
  }

  let zoomStep = datasetConfiguration.zoom;

  if (someTracing != null) {
    zoomStep = someTracing.zoomLevel;
  }

  if (urlStateZoomStep != null) {
    zoomStep = urlStateZoomStep;
  }

  let rotation = undefined;
  if (viewMode !== "orthogonal") {
    rotation = datasetConfiguration.rotation;

    if (someTracing != null) {
      rotation = Utils.point3ToVector3(someTracing.editRotation);
    }

    if (urlStateRotation != null) {
      rotation = urlStateRotation;
    }
  }

  const stateByLayer = urlStateByLayer ?? {};
  // Add the default mapping to the state for each layer that does not have a mapping set in its URL settings.
  for (const layerName in datasetConfiguration.layers) {
    if (!(layerName in stateByLayer)) {
      stateByLayer[layerName] = {};
    }
    const { mapping } = datasetConfiguration.layers[layerName];
    if (stateByLayer[layerName].mappingInfo == null && mapping != null) {
      stateByLayer[layerName].mappingInfo = {
        mappingName: mapping.name,
        mappingType: mapping.type,
      };
    }
  }

  // Overwriting the mapping to load for each volume layer in case
  // - the volume tracing has a not locked mapping set and the url does not.
  // - the volume tracing has a locked mapping set.
  // - the volume tracing has locked that no tracing should be loaded.
  const volumeTracings = tracings.filter(
    (tracing) => tracing.typ === "Volume",
  ) as ServerVolumeTracing[];
  for (const volumeTracing of volumeTracings) {
    const { id: layerName, mappingName, mappingIsLocked } = volumeTracing;

    if (!(layerName in stateByLayer)) {
      stateByLayer[layerName] = {};
    }
    if (stateByLayer[layerName].mappingInfo == null || mappingIsLocked) {
      // A locked mapping always takes precedence over the URL configuration.
      if (mappingName == null) {
        delete stateByLayer[layerName].mappingInfo;
      } else {
        stateByLayer[layerName].mappingInfo = {
          mappingName,
          mappingType: "HDF5",
        };
      }
    }
  }

  const activeNode = urlStateActiveNode;
  return {
    position,
    zoomStep,
    rotation,
    activeNode,
    stateByLayer,
    additionalCoordinates,
    ...rest,
  };
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

  if (state.additionalCoordinates != null) {
    Store.dispatch(setAdditionalCoordinatesAction(state.additionalCoordinates));
  }
}

async function applyLayerState(stateByLayer: UrlStateByLayer) {
  for (const layerName of Object.keys(stateByLayer)) {
    const layerState = stateByLayer[layerName];
    let effectiveLayerName;

    const { dataset } = Store.getState();

    if (layerName === "Skeleton" && layerState.isDisabled != null) {
      Store.dispatch(setShowSkeletonsAction(!layerState.isDisabled));
      // The remaining options are only valid for data layers
      continue;
    }

    try {
      // The name of the layer could have changed if a volume tracing was created from a viewed annotation
      effectiveLayerName = getLayerByName(dataset, layerName, true).name;
    } catch (e) {
      Toast.error(
        // @ts-ignore
        `URL configuration values for the layer "${layerName}" are ignored, because: ${e.message}`,
      );
      console.error(e);
      // @ts-ignore
      ErrorHandling.notify(e, {
        urlLayerState: stateByLayer,
      });
      continue;
    }

    if (layerState.isDisabled != null) {
      Store.dispatch(
        updateLayerSettingAction(effectiveLayerName, "isDisabled", layerState.isDisabled),
      );
    }

    if (!isSegmentationLayer(dataset, effectiveLayerName)) {
      // The remaining options are only valid for segmentation layers
      continue;
    }

    if (layerState.mappingInfo != null) {
      const { mappingName, mappingType, agglomerateIdsToImport } = layerState.mappingInfo;
      Store.dispatch(
        setMappingAction(effectiveLayerName, mappingName, mappingType, {
          showLoadingIndicator: true,
        }),
      );
      Store.dispatch(setMappingEnabledAction(effectiveLayerName, true));

      if (agglomerateIdsToImport != null) {
        const { tracing } = Store.getState();

        if (tracing.skeleton == null) {
          Toast.error(messages["tracing.agglomerate_skeleton.no_skeleton_tracing"]);
          continue;
        }

        if (mappingType !== "HDF5") {
          Toast.error(messages["tracing.agglomerate_skeleton.no_agglomerate_file_active"]);
          continue;
        }

        for (const agglomerateId of agglomerateIdsToImport) {
          Store.dispatch(
            loadAgglomerateSkeletonAction(effectiveLayerName, mappingName, agglomerateId),
          );
        }
      }
    }

    if (layerState.meshInfo) {
      const { meshFileName: currentMeshFileName, meshes } = layerState.meshInfo;

      if (currentMeshFileName != null) {
        const segmentationLayer = getSegmentationLayerByName(dataset, effectiveLayerName);
        // Ensure mesh files are loaded, so that the given mesh file name can be activated.
        // Doing this in a loop is fine, since it can only happen once (maximum) and there
        // are not many other iterations (== layers) which are blocked by this.

        await dispatchMaybeFetchMeshFilesAsync(Store.dispatch, segmentationLayer, dataset, false);
        Store.dispatch(updateCurrentMeshFileAction(effectiveLayerName, currentMeshFileName));
      }

      for (const mesh of meshes) {
        const { segmentId, seedPosition, seedAdditionalCoordinates } = mesh;

        if (mesh.isPrecomputed) {
          const { meshFileName } = mesh;
          Store.dispatch(
            loadPrecomputedMeshAction(
              segmentId,
              seedPosition,
              seedAdditionalCoordinates,
              meshFileName,
              effectiveLayerName,
            ),
          );
        } else {
          const { mappingName, mappingType } = mesh;
          Store.dispatch(
            loadAdHocMeshAction(
              segmentId,
              seedPosition,
              seedAdditionalCoordinates,
              {
                mappingName,
                mappingType,
              },
              effectiveLayerName,
            ),
          );
        }
      }
    }

    if (layerState.connectomeInfo != null) {
      const { connectomeName, agglomerateIdsToImport } = layerState.connectomeInfo;
      Store.dispatch(updateCurrentConnectomeFileAction(effectiveLayerName, connectomeName));

      if (agglomerateIdsToImport != null) {
        Store.dispatch(
          setActiveConnectomeAgglomerateIdsAction(effectiveLayerName, agglomerateIdsToImport),
        );
      }
    }
  }
}

function enforcePricingRestrictionsOnUserConfiguration(
  userConfiguration: UserConfiguration,
): UserConfiguration {
  const activeOrganization = Store.getState().activeOrganization;
  if (!isFeatureAllowedByPricingPlan(activeOrganization, PricingPlanEnum.Team)) {
    return {
      ...userConfiguration,
      renderWatermark: true,
    };
  }
  return userConfiguration;
}

function applyAnnotationSpecificViewConfiguration(
  annotation: APIAnnotation | null | undefined,
  dataset: APIDataset,
  originalDatasetSettings: DatasetConfiguration,
): DatasetConfiguration {
  /**
   * Apply annotation-specific view configurations to the dataset settings which are persisted
   * per user per dataset. The AnnotationViewConfiguration currently only holds the "isDisabled"
   * information per layer which should override the isDisabled information in DatasetConfiguration.
   */

  if (!annotation) {
    return originalDatasetSettings;
  }

  const initialDatasetSettings: DatasetConfiguration = _.cloneDeep(originalDatasetSettings);

  if (annotation.viewConfiguration) {
    // The annotation already contains a viewConfiguration. Merge that into the
    // dataset settings.
    for (const layerName of Object.keys(annotation.viewConfiguration.layers)) {
      _.merge(
        initialDatasetSettings.layers[layerName],
        annotation.viewConfiguration.layers[layerName],
      );
    }
    return initialDatasetSettings;
  }

  // The annotation does not contain a viewConfiguration (mainly happens when the
  // annotation was opened for the very first time).
  // Make the first volume layer visible and turn the other segmentation layers invisible,
  // since only one segmentation layer can be visible currently.
  const firstVolumeLayer = _.first(
    annotation.annotationLayers.filter((layer) => layer.typ === "Volume"),
  );
  if (!firstVolumeLayer) {
    // No volume layer exists. Return the original dataset settings
    return initialDatasetSettings;
  }

  const newLayers: Record<string, DatasetLayerConfiguration> = {};
  for (const layerName of Object.keys(initialDatasetSettings.layers)) {
    if (isSegmentationLayer(dataset, layerName)) {
      const shouldBeDisabled = firstVolumeLayer.tracingId !== layerName;

      newLayers[layerName] = {
        ...initialDatasetSettings.layers[layerName],
        isDisabled: shouldBeDisabled,
      };
    } else {
      newLayers[layerName] = initialDatasetSettings.layers[layerName];
    }
  }

  return {
    ...initialDatasetSettings,
    layers: newLayers,
  };
}
