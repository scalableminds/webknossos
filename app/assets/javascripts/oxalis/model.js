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
  DataLayerType,
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
import Binary from "oxalis/model/binary";
import ConnectionInfo from "oxalis/model/binarydata_connection_info";
import constants, { Vector3Indicies, ControlModeEnum, ModeValues } from "oxalis/constants";
import type { Vector3, Point3, ControlModeType } from "oxalis/constants";
import Request from "libs/request";
import Toast from "libs/toast";
import ErrorHandling from "libs/error_handling";
import UrlManager from "oxalis/controller/url_manager";
import {
  getTracing,
  getAnnotationInformation,
  getDataset,
  getSharingToken,
} from "admin/admin_rest_api";
import { getBitDepth } from "oxalis/model/binary/wkstore_adapter";
import messages from "messages";
import type { APIAnnotationType, APIDatasetType } from "admin/api_flow_types";
import type { DataTextureSizeAndCount } from "./model/binary/data_rendering_logic";
import * as DataRenderingLogic from "./model/binary/data_rendering_logic";

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

type ServerTracingBaseType = {
  id: string,
  userBoundingBox?: ServerBoundingBoxType,
  createdTimestamp: number,
  editPosition: Point3,
  editRotation: Point3,
  error?: string,
  version: number,
  zoomLevel: number,
};

export type ServerSkeletonTracingType = ServerTracingBaseType & {
  activeNodeId?: number,
  boundingBox?: ServerBoundingBoxType,
  trees: Array<ServerSkeletonTracingTreeType>,
  treeGroups: ?Array<TreeGroupType>,
};

export type ServerVolumeTracingType = ServerTracingBaseType & {
  activeSegmentId?: number,
  boundingBox: ServerBoundingBoxType,
  elementClass: ElementClassType,
  fallbackLayer?: string,
  largestSegmentId: number,
};

export type ServerTracingType = ServerSkeletonTracingType | ServerVolumeTracingType;

// TODO: Non-reactive
export class OxalisModel {
  HANDLED_ERROR = "error_was_handled";

  connectionInfo: ConnectionInfo;
  binary: {
    [key: string]: Binary,
  };
  lowerBoundary: Vector3;
  upperBoundary: Vector3;
  isMappingSupported: boolean = true;
  maximumDataTextureCountForLayer: number;

  async fetch(
    tracingType: TracingTypeTracingType,
    annotationId: string,
    controlMode: ControlModeType,
    initialFetch: boolean,
  ) {
    Store.dispatch(setControlModeAction(controlMode));

    let annotation: ?APIAnnotationType;
    let datasetName;
    if (controlMode === ControlModeEnum.TRACE) {
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
      // In View mode, the annotationId is actually the dataSetName
      // as there is no annotation and no tracing!
      datasetName = annotationId;
    }

    const highestResolutions = await this.initializeDataset(datasetName);
    await this.initializeSettings(datasetName);

    // Fetch the actual tracing from the datastore, if there is an annotation
    let tracing: ?ServerTracingType;
    if (annotation != null) {
      tracing = await getTracing(annotation);
    }

    // Only initialize the model once.
    // There is no need to reinstantiate the binaries if the dataset didn't change.
    if (initialFetch) {
      this.initializeModel(tracing, highestResolutions);
      if (tracing != null) Store.dispatch(setZoomStepAction(tracing.zoomLevel));
    }

    // There is no need to initialize the tracing if there is no tracing (View mode).
    if (annotation != null && tracing != null) {
      this.initializeTracing(annotation, tracing);
    }

    this.applyState(UrlManager.initialState, tracing);
  }

  validateSpecsForLayers(
    layers: Array<DataLayerType>,
  ): Map<DataLayerType, DataTextureSizeAndCount> {
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
    const controlMode = Store.getState().temporaryConfiguration.controlMode;
    if (controlMode === ControlModeEnum.TRACE) {
      if (isVolume) {
        ErrorHandling.assert(
          this.getSegmentationBinary() != null,
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

  async initializeDataset(datasetName: string): Promise<Array<Vector3>> {
    const sharingToken = getSharingToken();
    const rawDataset =
      sharingToken != null
        ? await getDataset(datasetName, sharingToken)
        : await getDataset(datasetName);

    let error;
    if (!rawDataset) {
      error = messages["dataset.does_not_exist"];
    } else if (!rawDataset.dataSource.dataLayers) {
      error = `${messages["dataset.not_imported"]} '${datasetName}'`;
    }

    if (error) {
      Toast.error(error);
      throw this.HANDLED_ERROR;
    }

    const [dataset, highestResolutions] = adaptResolutions(rawDataset);

    // Make sure subsequent fetch calls are always for the same dataset
    if (!_.isEmpty(this.binary)) {
      ErrorHandling.assert(
        _.isEqual(dataset.dataSource.id.name, Store.getState().dataset.name),
        messages["dataset.changed_without_reload"],
      );
    }

    ErrorHandling.assertExtendContext({
      dataSet: dataset.dataSource.id.name,
    });

    Store.dispatch(setDatasetAction(dataset));

    return highestResolutions;
  }

  async initializeSettings(datasetName: string) {
    const initialUserSettings = await Request.receiveJSON("/api/user/userConfiguration");
    const initialDatasetSettings = await Request.receiveJSON(
      `/api/dataSetConfigurations/${datasetName}`,
    );
    Store.dispatch(initializeSettingsAction(initialUserSettings, initialDatasetSettings));
  }

  initializeModel(tracing: ?ServerTracingType, resolutions: Array<Vector3>) {
    const layers = this.getLayerInfos(tracing, resolutions);

    const textureInformationPerLayer = this.validateSpecsForLayers(layers);
    this.maximumDataTextureCountForLayer = _.max(
      Array.from(textureInformationPerLayer.values()).map(info => info.textureCount),
    );

    this.connectionInfo = new ConnectionInfo();
    this.binary = {};
    for (const layer of layers) {
      const textureInformation = textureInformationPerLayer.get(layer);
      if (!textureInformation) {
        throw new Error("No texture information for layer?");
      }
      this.binary[layer.name] = new Binary(
        layer,
        this.connectionInfo,
        textureInformation.textureSize,
        textureInformation.textureCount,
      );
    }

    this.buildMappingsObject();

    if (this.getColorBinaries().length === 0) {
      Toast.error(messages["dataset.no_data"]);
      throw this.HANDLED_ERROR;
    }

    this.computeBoundaries();
  }

  // For now, since we have no UI for this
  buildMappingsObject() {
    const segmentationBinary = this.getSegmentationBinary();

    if (segmentationBinary != null && this.isMappingSupported) {
      window.mappings = {
        getAll() {
          return segmentationBinary.mappings.getMappingNames();
        },
        getActive() {
          return segmentationBinary.activeMapping;
        },
        activate(mapping) {
          return segmentationBinary.setActiveMapping(mapping);
        },
      };
    }
  }

  getColorBinaries() {
    return _.filter(this.binary, binary => binary.category === "color");
  }

  getSegmentationBinary() {
    return _.find(this.binary, binary => binary.category === "segmentation");
  }

  getBinaryByName(name: string) {
    return this.binary[name];
  }

  getLayerInfos(tracing: ?ServerTracingType, resolutions: Array<Vector3>): Array<DataLayerType> {
    // This method adds/merges the layers of the tracing into the dataset layers
    // Overwrite or extend layers with volumeTracingLayer
    let layers = _.clone(Store.getState().dataset.dataSource.dataLayers);
    const adaptResolutionInfoForLayer = layer => ({
      ...layer,
      // The server only provides the actual resolutions for a layer. However,
      // we adapt these resolutions to the most extensive one (across all layers),
      // since resolutions are used when converting positions between zoomSteps and this
      // should be possible even if the layer does not support a resolution.
      // To not lose the information, which resolution a layer truly supports, we add
      // maxZoomStep as another flag here (derived by reading the resolutions array which
      // the server provides)
      resolutions,
      maxZoomStep: layer.resolutions.length - 1,
    });

    // $FlowFixMe TODO Why does Flow complain about this check
    if (tracing == null || tracing.elementClass == null) {
      return layers.map(adaptResolutionInfoForLayer);
    }

    // Flow doesn't understand that as the tracing has the elementClass property it has to be a volumeTracing
    tracing = ((tracing: any): ServerVolumeTracingType);

    // This code will only be executed for volume tracings as only those have a dataLayer.
    // The tracing always contains the layer information for the user segmentation.
    // layers (dataset.dataLayers) contains information about all existing layers of the dataset.
    // Two possible cases:
    // 1) No segmentation exists yet: In that case layers doesn't contain the dataLayer.
    // 2) Segmentation exists: In that case layers already contains dataLayer and the fallbackLayer
    //    property specifies its name, to be able to merge the two layers
    const fallbackLayerName = tracing.fallbackLayer;
    const fallbackLayerIndex = _.findIndex(layers, layer => layer.name === fallbackLayerName);
    const fallbackLayer = layers[fallbackLayerIndex];

    const tracingLayer = {
      name: tracing.id,
      category: "segmentation",
      boundingBox: {
        topLeft: [
          tracing.boundingBox.topLeft.x,
          tracing.boundingBox.topLeft.y,
          tracing.boundingBox.topLeft.z,
        ],
        width: tracing.boundingBox.width,
        height: tracing.boundingBox.height,
        depth: tracing.boundingBox.depth,
      },
      resolutions,
      maxZoomStep: resolutions.length - 1,
      elementClass: tracing.elementClass,
      mappings:
        fallbackLayer != null && fallbackLayer.mappings != null ? fallbackLayer.mappings : [],
      largestSegmentId: tracing.largestSegmentId,
    };

    if (fallbackLayer != null) {
      layers[fallbackLayerIndex] = tracingLayer;
    } else {
      // Remove other segmentation layers, since we are adding a new one.
      // This is a temporary workaround. In the long term we want to support
      // multiple segmentation layers.
      layers = layers.filter(layer => layer.category !== "segmentation");
      layers.push(tracingLayer);
    }
    return layers.map(adaptResolutionInfoForLayer);
  }

  computeBoundaries() {
    this.lowerBoundary = [Infinity, Infinity, Infinity];
    this.upperBoundary = [-Infinity, -Infinity, -Infinity];

    for (const key of Object.keys(this.binary)) {
      const binary = this.binary[key];
      for (const i of Vector3Indicies) {
        this.lowerBoundary[i] = Math.min(this.lowerBoundary[i], binary.lowerBoundary[i]);
        this.upperBoundary[i] = Math.max(this.upperBoundary[i], binary.upperBoundary[i]);
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

  getResolutions(): Array<Vector3> {
    // Different layers can have different resolutions. At the moment,
    // unequal resolutions will result in undefined behavior.
    // However, if resolutions are subset of each other, everything should be fine.
    // For that case, returning the longest resolutions array should suffice

    return _.chain(this.binary)
      .map(b => b.layer.resolutions)
      .sortBy(resolutions => resolutions.length)
      .last()
      .valueOf();
  }

  stateSaved() {
    const state = Store.getState();
    const storeStateSaved = !state.save.isBusy && state.save.queue.length === 0;
    const pushQueuesSaved = _.reduce(
      this.binary,
      (saved, binary) => saved && binary.pushQueue.stateSaved(),
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

function adaptResolutions(dataset: APIDatasetType): [APIDatasetType, Array<Vector3>] {
  const adaptedLayers = dataset.dataSource.dataLayers.map(dataLayer => {
    const adaptedResolutions = dataLayer.resolutions.slice();
    _.range(constants.DOWNSAMPLED_ZOOM_STEP_COUNT).forEach(() => {
      // We add another level of resolutions to allow zooming out even further
      const lastResolution = _.last(adaptedResolutions);
      adaptedResolutions.push([
        2 * lastResolution[0],
        2 * lastResolution[1],
        2 * lastResolution[2],
      ]);
    });

    return {
      ...dataLayer,
      resolutions: adaptedResolutions,
    };
  });

  const highestResolutions = _.last(
    _.sortBy(adaptedLayers.map(layer => layer.resolutions), resolutions => resolutions.length),
  );

  const adaptedDataset = {
    ...dataset,
    dataSource: {
      ...dataset.dataSource,
      dataLayers: adaptedLayers,
    },
  };

  return [adaptedDataset, highestResolutions];
}

// export the model as a singleton
export default new OxalisModel();
