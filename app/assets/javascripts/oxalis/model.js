/**
 * model.js
 * @flow
 */
import _ from "lodash";
import Store from "oxalis/store";
import type {
  SettingsType,
  EdgeType,
  CommentType,
  TracingTypeTracingType,
  ElementClassType,
  TreeGroupType,
} from "oxalis/store";
import type { UrlManagerState } from "oxalis/controller/url_manager";
import {
  setDatasetAction,
  setViewModeAction,
  setControlModeAction,
  initializeSettingsAction,
} from "oxalis/model/actions/settings_actions";
import {
  setActiveNodeAction,
  initializeSkeletonTracingAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { initializeVolumeTracingAction } from "oxalis/model/actions/volumetracing_actions";
import { setTaskAction } from "oxalis/model/actions/task_actions";
import {
  setPositionAction,
  setZoomStepAction,
  setRotationAction,
} from "oxalis/model/actions/flycam_actions";
import { saveNowAction } from "oxalis/model/actions/save_actions";
import window from "libs/window";
import Utils from "libs/utils";
import DataLayer from "oxalis/model/data_layer";
import ConnectionInfo from "oxalis/model/data_connection_info";
import constants, { Vector3Indicies, ControlModeEnum, ModeValues } from "oxalis/constants";
import type { Vector3, Point3, ControlModeType } from "oxalis/constants";
import Toast from "libs/toast";
import ErrorHandling from "libs/error_handling";
import UrlManager from "oxalis/controller/url_manager";
import {
  getTracingForAnnotation,
  getAnnotationInformation,
  getDataset,
  getSharingToken,
  getUserConfiguration,
  getDatasetConfiguration,
} from "admin/admin_rest_api";
import { getBitDepth } from "oxalis/model/bucket_data_handling/wkstore_adapter";
import messages from "messages";
import type { APIAnnotationType, APIDatasetType, APIDataLayerType } from "admin/api_flow_types";
import { getLayerByName } from "oxalis/model/accessors/dataset_accessor";
import { convertPointToVecInBoundingBox } from "oxalis/model/reducers/reducer_helpers";
import Maybe from "data.maybe";
import type { DataTextureSizeAndCount } from "./model/bucket_data_handling/data_rendering_logic";
import * as DataRenderingLogic from "./model/bucket_data_handling/data_rendering_logic";

export type ServerNodeType = {
  id: number,
  position: Point3,
  rotation: Point3,
  bitDepth: number,
  viewport: number,
  resolution: number,
  radius: number,
  createdTimestamp: number,
  interpolation: boolean,
};

export type ServerBranchPointType = {
  createdTimestamp: number,
  nodeId: number,
};

export type ServerBoundingBoxType = {
  topLeft: Point3,
  width: number,
  height: number,
  depth: number,
};

export type ServerSkeletonTracingTreeType = {
  branchPoints: Array<ServerBranchPointType>,
  color: ?{ r: number, g: number, b: number },
  comments: Array<CommentType>,
  edges: Array<EdgeType>,
  name: string,
  nodes: Array<ServerNodeType>,
  treeId: number,
  createdTimestamp: number,
  groupId?: ?number,
};

type ServerTracingBaseType = {|
  id: string,
  userBoundingBox?: ServerBoundingBoxType,
  createdTimestamp: number,
  editPosition: Point3,
  editRotation: Point3,
  error?: string,
  version: number,
  zoomLevel: number,
|};

export type ServerSkeletonTracingType = {|
  ...ServerTracingBaseType,
  activeNodeId?: number,
  boundingBox?: ServerBoundingBoxType,
  trees: Array<ServerSkeletonTracingTreeType>,
  treeGroups: ?Array<TreeGroupType>,
|};

export type ServerVolumeTracingType = {|
  ...ServerTracingBaseType,
  activeSegmentId?: number,
  boundingBox: ServerBoundingBoxType,
  elementClass: ElementClassType,
  fallbackLayer?: string,
  largestSegmentId: number,
|};

export type ServerTracingType = ServerSkeletonTracingType | ServerVolumeTracingType;

const asVolumeTracingMaybe = (tracing: ?ServerTracingType): Maybe<ServerVolumeTracingType> => {
  if (tracing && tracing.elementClass) {
    return Maybe.Just(tracing);
  } else {
    return Maybe.Nothing();
  }
};

// TODO: Non-reactive
export class OxalisModel {
  HANDLED_ERROR = "error_was_handled";

  connectionInfo: ConnectionInfo;
  dataLayers: {
    [key: string]: DataLayer,
  };
  lowerBoundary: Vector3;
  upperBoundary: Vector3;
  isMappingSupported: boolean = true;
  maximumDataTextureCountForLayer: number;

  async fetch(
    tracingType: TracingTypeTracingType,
    annotationIdOrDatasetName: string,
    controlMode: ControlModeType,
    initialFetch: boolean,
  ) {
    Store.dispatch(setControlModeAction(controlMode));

    let annotation: ?APIAnnotationType;
    let datasetName;
    if (controlMode === ControlModeEnum.TRACE) {
      const annotationId = annotationIdOrDatasetName;
      annotation = await getAnnotationInformation(annotationId, tracingType);
      datasetName = annotation.dataSetName;

      if (!annotation.restrictions.allowAccess) {
        Toast.error(messages["tracing.no_access"]);
        throw this.HANDLED_ERROR;
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

    const [
      dataset,
      initialUserSettings,
      initialDatasetSettings,
      tracing,
    ] = await this.fetchParallel(annotation, datasetName);

    this.initializeDataset(dataset, tracing);
    this.initializeSettings(initialUserSettings, initialDatasetSettings);

    // There is no need to reinstantiate the DataLayers if the dataset didn't change.
    if (initialFetch) {
      this.initializeDataLayerInstances();
      if (tracing != null) Store.dispatch(setZoomStepAction(tracing.zoomLevel));
    }

    // There is no need to initialize the tracing if there is no tracing (View mode).
    if (annotation != null && tracing != null) {
      this.initializeTracing(annotation, tracing);
    }

    this.applyState(UrlManager.initialState, tracing);
  }

  async fetchParallel(
    annotation: ?APIAnnotationType,
    datasetName: string,
  ): Promise<[APIDatasetType, *, *, ?ServerTracingType]> {
    return Promise.all([
      getDataset(datasetName, getSharingToken()),
      getUserConfiguration(),
      getDatasetConfiguration(datasetName),
      // Fetch the actual tracing from the datastore, if there is an annotation
      // (Also see https://github.com/facebook/flow/issues/4936)
      // $FlowFixMe: Type inference with promise all seems to be a bit broken in flow
      annotation ? getTracingForAnnotation(annotation) : null,
    ]);
  }

  validateSpecsForLayers(
    layers: Array<APIDataLayerType>,
  ): Map<APIDataLayerType, DataTextureSizeAndCount> {
    const specs = DataRenderingLogic.getSupportedTextureSpecs();
    DataRenderingLogic.validateMinimumRequirements(specs);

    const hasSegmentation = _.find(layers, layer => layer.category === "segmentation") != null;
    const setupInfo = DataRenderingLogic.computeDataTexturesSetup(
      specs,
      layers,
      layer => getBitDepth(layer) >> 3,
      hasSegmentation,
    );

    if (!setupInfo.isBasicRenderingSupported) {
      const message = `Not enough textures available for rendering ${layers.length} layers`;
      Toast.error(message);
      throw new Error(message);
    }

    if (!setupInfo.isMappingSupported) {
      const message = messages["mapping.too_few_textures"];
      console.warn(message);
      this.isMappingSupported = false;
    }

    return setupInfo.textureInformationPerLayer;
  }

  determineAllowedModes(settings: SettingsType) {
    // The order of allowedModes should be independent from the server and instead be similar to ModeValues
    let allowedModes = _.intersection(ModeValues, settings.allowedModes);

    const colorLayer = _.find(Store.getState().dataset.dataSource.dataLayers, {
      category: "color",
    });
    if (colorLayer != null && colorLayer.elementClass !== "uint8") {
      allowedModes = allowedModes.filter(mode => !constants.MODES_ARBITRARY.includes(mode));
    }

    let preferredMode = null;
    if (settings.preferredMode != null) {
      const modeId = settings.preferredMode;
      if (allowedModes.includes(modeId)) {
        preferredMode = modeId;
      }
    }

    return { preferredMode, allowedModes };
  }

  initializeTracing(annotation: APIAnnotationType, tracing: ServerTracingType) {
    // This method is not called for the View mode
    const { allowedModes, preferredMode } = this.determineAllowedModes(annotation.settings);
    _.extend(annotation.settings, { allowedModes, preferredMode });

    const isVolume = annotation.content.typ === "volume";
    const { controlMode } = Store.getState().temporaryConfiguration;
    if (controlMode === ControlModeEnum.TRACE) {
      if (isVolume) {
        ErrorHandling.assert(
          this.getSegmentationLayer() != null,
          messages["tracing.volume_missing_segmentation"],
        );
        const volumeTracing: ServerVolumeTracingType = (tracing: any);
        Store.dispatch(initializeVolumeTracingAction(annotation, volumeTracing));
      } else {
        const skeletonTracing: ServerSkeletonTracingType = (tracing: any);

        // To generate a huge amount of dummy trees, use:
        // import generateDummyTrees from "./model/helpers/generate_dummy_trees";
        // tracing.trees = generateDummyTrees(1, 200000);
        Store.dispatch(initializeSkeletonTracingAction(annotation, skeletonTracing));
      }
    }

    // Initialize 'flight', 'oblique' or 'orthogonal'/'volume' mode
    if (allowedModes.length === 0) {
      Toast.error(messages["tracing.no_allowed_mode"]);
    } else {
      const mode = preferredMode || UrlManager.initialState.mode || allowedModes[0];
      Store.dispatch(setViewModeAction(mode));
    }
  }

  initializeDataset(dataset: APIDatasetType, tracing: ?ServerTracingType): void {
    let error;
    if (!dataset) {
      error = messages["dataset.does_not_exist"];
    } else if (!dataset.dataSource.dataLayers) {
      error = `${messages["dataset.not_imported"]} '${dataset.name}'`;
    }

    if (error) {
      Toast.error(error);
      throw this.HANDLED_ERROR;
    }

    // Make sure subsequent fetch calls are always for the same dataset
    if (!_.isEmpty(this.dataLayers)) {
      ErrorHandling.assert(
        _.isEqual(dataset.dataSource.id.name, Store.getState().dataset.name),
        messages["dataset.changed_without_reload"],
      );
    }

    ErrorHandling.assertExtendContext({
      dataSet: dataset.dataSource.id.name,
    });

    asVolumeTracingMaybe(tracing).map(volumeTracing => {
      const newDataLayers = this.setupLayerForVolumeTracing(
        dataset.dataSource.dataLayers,
        volumeTracing,
      );
      // $FlowFixMe We mutate the dataset here to avoid that an outdated version is used somewhere else
      dataset.dataSource.dataLayers = newDataLayers;
    });

    Store.dispatch(setDatasetAction(dataset));
  }

  initializeSettings(initialUserSettings: Object, initialDatasetSettings: Object): void {
    Store.dispatch(initializeSettingsAction(initialUserSettings, initialDatasetSettings));
  }

  initializeDataLayerInstances() {
    const layers = Store.getState().dataset.dataSource.dataLayers;

    const textureInformationPerLayer = this.validateSpecsForLayers(layers);
    this.maximumDataTextureCountForLayer = _.max(
      Array.from(textureInformationPerLayer.values()).map(info => info.textureCount),
    );

    this.connectionInfo = new ConnectionInfo();
    this.dataLayers = {};
    for (const layer of layers) {
      const textureInformation = textureInformationPerLayer.get(layer);
      if (!textureInformation) {
        throw new Error("No texture information for layer?");
      }
      this.dataLayers[layer.name] = new DataLayer(
        layer,
        this.connectionInfo,
        textureInformation.textureSize,
        textureInformation.textureCount,
      );
    }

    this.buildMappingsObject();

    if (this.getColorLayers().length === 0) {
      Toast.error(messages["dataset.no_data"]);
      throw this.HANDLED_ERROR;
    }

    this.computeBoundaries();
  }

  // For now, since we have no UI for this
  buildMappingsObject() {
    const segmentationLayer = this.getSegmentationLayer();

    if (segmentationLayer != null && this.isMappingSupported) {
      window.mappings = {
        getAll() {
          return segmentationLayer.mappings.getMappingNames();
        },
        getActive() {
          return segmentationLayer.activeMapping;
        },
        activate(mapping) {
          return segmentationLayer.setActiveMapping(mapping);
        },
      };
    }
  }

  getAllLayers(): Array<DataLayer> {
    // $FlowFixMe remove once https://github.com/facebook/flow/issues/2221 is fixed
    return Object.values(this.dataLayers);
  }

  getColorLayers(): Array<DataLayer> {
    return _.filter(
      this.dataLayers,
      dataLayer => getLayerByName(Store.getState().dataset, dataLayer.name).category === "color",
    );
  }

  // todo: add ?DataLayer as return type
  getSegmentationLayer() {
    return _.find(
      this.dataLayers,
      dataLayer =>
        getLayerByName(Store.getState().dataset, dataLayer.name).category === "segmentation",
    );
  }

  getLayerByName(name: string): ?DataLayer {
    return this.dataLayers[name];
  }

  setupLayerForVolumeTracing(
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
      mappings:
        fallbackLayer != null && fallbackLayer.mappings != null ? fallbackLayer.mappings : [],
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

  computeBoundaries() {
    this.lowerBoundary = [Infinity, Infinity, Infinity];
    this.upperBoundary = [-Infinity, -Infinity, -Infinity];

    for (const key of Object.keys(this.dataLayers)) {
      const dataLayer = this.dataLayers[key];
      for (const i of Vector3Indicies) {
        this.lowerBoundary[i] = Math.min(this.lowerBoundary[i], dataLayer.lowerBoundary[i]);
        this.upperBoundary[i] = Math.max(this.upperBoundary[i], dataLayer.upperBoundary[i]);
      }
    }
  }

  getDatasetCenter(): Vector3 {
    return [
      (this.lowerBoundary[0] + this.upperBoundary[0]) / 2,
      (this.lowerBoundary[1] + this.upperBoundary[1]) / 2,
      (this.lowerBoundary[2] + this.upperBoundary[2]) / 2,
    ];
  }

  applyState(urlState: UrlManagerState, tracing: ?ServerTracingType) {
    // If there is no editPosition (e.g. when viewing a dataset) and
    // no default position, compute the center of the dataset
    const defaultPosition = Store.getState().datasetConfiguration.position;
    let position = this.getDatasetCenter();
    if (defaultPosition != null) {
      position = defaultPosition;
    }
    if (tracing != null) {
      position = Utils.point3ToVector3(tracing.editPosition);
    }
    if (urlState.position != null) {
      position = urlState.position;
    }
    Store.dispatch(setPositionAction(position));

    const defaultZoomStep = Store.getState().datasetConfiguration.zoom;
    if (urlState.zoomStep != null) {
      Store.dispatch(setZoomStepAction(urlState.zoomStep));
    } else if (defaultZoomStep != null) {
      Store.dispatch(setZoomStepAction(defaultZoomStep));
    }

    const defaultRotation = Store.getState().datasetConfiguration.rotation;
    let rotation = null;
    if (defaultRotation != null) {
      rotation = defaultRotation;
    }
    if (tracing != null) {
      rotation = Utils.point3ToVector3(tracing.editRotation);
    }
    if (urlState.rotation != null) {
      rotation = urlState.rotation;
    }
    if (rotation != null) {
      Store.dispatch(setRotationAction(rotation));
    }

    if (urlState.activeNode != null) {
      Store.dispatch(setActiveNodeAction(urlState.activeNode));
    }
  }

  stateSaved() {
    const state = Store.getState();
    const storeStateSaved = !state.save.isBusy && state.save.queue.length === 0;
    const pushQueuesSaved = _.reduce(
      this.dataLayers,
      (saved, dataLayer) => saved && dataLayer.pushQueue.stateSaved(),
      true,
    );
    return storeStateSaved && pushQueuesSaved;
  }

  save = async () => {
    while (!this.stateSaved()) {
      // The dispatch of the saveNowAction IN the while loop is deliberate.
      // Otherwise if an update action is pushed to the save queue during the Utils.sleep,
      // the while loop would continue running until the next save would be triggered.
      Store.dispatch(saveNowAction());
      // eslint-disable-next-line no-await-in-loop
      await Utils.sleep(500);
    }
  };
}

// export the model as a singleton
export default new OxalisModel();
