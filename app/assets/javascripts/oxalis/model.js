/**
 * model.js
 * @flow
 */

import _ from "lodash";
import Store from "oxalis/store";
import type {
  DatasetType,
  BoundingBoxObjectType,
  RestrictionsType,
  SettingsType,
  NodeType,
  EdgeType,
  CommentType,
  BranchPointType,
  SkeletonTracingTypeTracingType,
  VolumeTracingTypeTracingType,
  TaskType,
} from "oxalis/store";
import type { UrlManagerState } from "oxalis/controller/url_manager";
import { setDatasetAction, setViewModeAction, setControlModeAction } from "oxalis/model/actions/settings_actions";
import { setActiveNodeAction, initializeSkeletonTracingAction } from "oxalis/model/actions/skeletontracing_actions";
import { initializeVolumeTracingAction } from "oxalis/model/actions/volumetracing_actions";
import { initializeReadOnlyTracingAction } from "oxalis/model/actions/readonlytracing_actions";
import { setTaskAction } from "oxalis/model/actions/task_actions";
import { setPositionAction, setZoomStepAction, setRotationAction } from "oxalis/model/actions/flycam_actions";
import { saveNowAction } from "oxalis/model/actions/save_actions";
import window from "libs/window";
import Utils from "libs/utils";
import Binary from "oxalis/model/binary";
import ConnectionInfo from "oxalis/model/binarydata_connection_info";
import { getIntegerZoomStep } from "oxalis/model/accessors/flycam_accessor";
import constants, { Vector3Indicies, ControlModeEnum, ModeValues } from "oxalis/constants";
import type { Vector3, ControlModeType } from "oxalis/constants";
import Request from "libs/request";
import Toast from "libs/toast";
import ErrorHandling from "libs/error_handling";
import WkLayer from "oxalis/model/binary/layers/wk_layer";
import NdStoreLayer from "oxalis/model/binary/layers/nd_store_layer";
import update from "immutability-helper";
import UrlManager from "oxalis/controller/url_manager";

type SkeletonContentTreeType = {
  id: number,
  color: ?Vector3,
  name: string,
  timestamp: number,
  comments: Array<CommentType>,
  branchPoints: Array<BranchPointType>,
  edges: Array<EdgeType>,
  nodes: Array<NodeType>,
};

export type SkeletonContentDataType = {
  activeNode: null | number;
  trees: Array<SkeletonContentTreeType>;
  zoomLevel: number;
  customLayers: null;
  zoomLevel: number;
};

export type VolumeContentDataType = {
  activeCell: null | number;
  nextCell: ?number,
  customLayers: Array<Object>;
  boundingBox: BoundingBoxObjectType;
  name: string;
  zoomLevel: number;
};

export type ServerTracing<T> = {
  actions: Array<any>,
  content: {
    boundingBox: BoundingBoxObjectType,
    contentData: T,
    contentType: string,
    dataSet: DatasetType,
    editPosition: Vector3,
    editRotation: Vector3,
    settings: SettingsType,
  },
  contentType: string,
  created: string,
  dataSetName: string,
  downloadUrl: string,
  formattedHash: string,
  id: string,
  name: string,
  restrictions: RestrictionsType,
  state: UrlManagerState,
  stateLabel: string,
  stats: any,
  task: TaskType,
  tracingTime: number,
  typ: SkeletonTracingTypeTracingType | VolumeTracingTypeTracingType,
  user: any,
  version: number,
};

// TODO: Non-reactive
export class OxalisModel {
  HANDLED_ERROR = "error_was_handled";

  connectionInfo: ConnectionInfo;
  binary: {
    [key: string]: Binary,
  };
  lowerBoundary: Vector3;
  upperBoundary: Vector3;
  tracing: ServerTracing<SkeletonContentDataType | VolumeContentDataType>;

  async fetch(tracingType: SkeletonTracingTypeTracingType, tracingId: string, controlMode: ControlModeType, initialFetch: boolean) {
    Store.dispatch(setControlModeAction(controlMode));

    let infoUrl;
    if (controlMode === ControlModeEnum.TRACE) {
      // Include /readOnly part whenever it is in the pathname
      const isReadOnly = window.location.pathname.endsWith("/readOnly");
      const readOnlyPart = isReadOnly ? "readOnly/" : "";
      infoUrl = `/annotations/${tracingType}/${tracingId}/${readOnlyPart}info`;
    } else {
      infoUrl = `/annotations/${tracingType}/${tracingId}/info`;
    }

    const tracing: ServerTracing<*> = await Request.receiveJSON(infoUrl);

    let error;
    const dataset = tracing.content.dataSet;
    if (tracing.error) {
      ({ error } = tracing);
    } else if (!dataset) {
      error = "Selected dataset doesn't exist";
    } else if (!dataset.dataLayers) {
      if (dataset.name) {
        error = `Please, double check if you have the dataset '${dataset.name}' imported.`;
      } else {
        error = "Please, make sure you have a dataset imported.";
      }
    }

    if (error) {
      Toast.error(error);
      throw this.HANDLED_ERROR;
    }

    if (!tracing.restrictions.allowAccess) {
      error = "You are not allowed to access this tracing";
      throw this.HANDLED_ERROR;
    }

    // Make sure subsequent fetch calls are always for the same dataset
    if (!_.isEmpty(this.binary)) {
      ErrorHandling.assert(_.isEqual(dataset, Store.getState().dataset),
        "Model.fetch was called for a task with another dataset, without reloading the page.");
    }

    ErrorHandling.assertExtendContext({
      task: tracing.id,
      dataSet: dataset.name,
    });

    Store.dispatch(setDatasetAction(dataset));
    Store.dispatch(setTaskAction(tracing.task));

    // Only initialize the model once.
    // There is no need to reinstantiate the binaries if the dataset didn't change.
    if (initialFetch) {
      this.initializeModel(tracing);
    }
    this.initializeTracing(tracing, initialFetch);

    return tracing;
  }

  determineAllowedModes(settings: SettingsType) {
    // The order of allowedModes should be independent from the server and instead be similar to ModeValues
    let allowedModes = _.intersection(ModeValues, settings.allowedModes);

    const colorLayer = _.find(Store.getState().dataset.dataLayers, { category: "color" });
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

  initializeTracing(tracing: ServerTracing<SkeletonContentDataType | VolumeContentDataType>, initialFetch: boolean) {
    const { allowedModes, preferredMode } = this.determineAllowedModes(tracing.content.settings);
    _.extend(tracing.content.settings, { allowedModes, preferredMode });

    const isVolume = tracing.content.settings.allowedModes.includes("volume");
    const controlMode = Store.getState().temporaryConfiguration.controlMode;
    if (controlMode === ControlModeEnum.TRACE) {
      if (isVolume) {
        ErrorHandling.assert((this.getSegmentationBinary() != null),
          "Volume is allowed, but segmentation does not exist");
        const volumeTracing: ServerTracing<VolumeContentDataType> = (tracing: ServerTracing<any>);
        Store.dispatch(initializeVolumeTracingAction(volumeTracing));
      } else {
        const skeletonTracing: ServerTracing<SkeletonContentDataType> = (tracing: ServerTracing<any>);
        Store.dispatch(initializeSkeletonTracingAction(skeletonTracing));
      }
    } else {
      const readOnlyTracing: ServerTracing<SkeletonContentDataType> = (tracing: ServerTracing<any>);
      Store.dispatch(initializeReadOnlyTracingAction(readOnlyTracing));
    }

    if (initialFetch) {
      Store.dispatch(setZoomStepAction(tracing.content.contentData.zoomLevel));
    }

    // Initialize 'flight', 'oblique' or 'orthogonal'/'volume' mode
    if (allowedModes.length === 0) {
      Toast.error("There was no valid allowed tracing mode specified.");
    } else {
      const mode = preferredMode || UrlManager.initialState.mode || allowedModes[0];
      Store.dispatch(setViewModeAction(mode));
    }

    this.applyState(UrlManager.initialState, tracing);
  }

  initializeModel(tracing: ServerTracing<SkeletonContentDataType | VolumeContentDataType>) {
    const dataset = tracing.content.dataSet;
    const { dataStore } = dataset;

    const LayerClass = (() => {
      switch (dataStore.typ) {
        case "webknossos-store": return WkLayer;
        case "ndstore": return NdStoreLayer;
        default: throw new Error(`Unknown datastore type: ${dataStore.typ}`);
      }
    })();

    const layers = this.getLayerInfos(tracing.content.contentData.customLayers)
      .map(layerInfo => new LayerClass(layerInfo, dataStore));

    this.connectionInfo = new ConnectionInfo();
    this.binary = {};

    let maxZoomStep = -Infinity;

    for (const layer of layers) {
      const maxLayerZoomStep = Math.log(Math.max(...layer.resolutions)) / Math.LN2;
      this.binary[layer.name] = new Binary(tracing, layer, maxLayerZoomStep, this.connectionInfo);
      maxZoomStep = Math.max(maxZoomStep, maxLayerZoomStep);
    }

    this.buildMappingsObject();

    if (this.getColorBinaries().length === 0) {
      Toast.error("No data available! Something seems to be wrong with the dataset.");
      throw this.HANDLED_ERROR;
    }

    this.computeBoundaries();

    // TODO: remove
    this.tracing = tracing;
  }

  // For now, since we have no UI for this
  buildMappingsObject() {
    const segmentationBinary = this.getSegmentationBinary();

    if (segmentationBinary != null) {
      window.mappings = {
        getAll() { return segmentationBinary.mappings.getMappingNames(); },
        getActive() { return segmentationBinary.activeMapping; },
        activate(mapping) { return segmentationBinary.setActiveMapping(mapping); },
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

  getLayerInfos(userLayers: ?Array<Object>) {
    // Overwrite or extend layers with userLayers

    const dataset = Store.getState().dataset;
    const layers = dataset == null ? [] : _.clone(dataset.dataLayers);
    if (userLayers == null) { return layers; }

    for (const userLayer of userLayers) {
      const existingLayerIndex = _.findIndex(layers, layer => layer.name === Utils.__guard__(userLayer.fallback, x => x.layerName));
      const existingLayer = layers[existingLayerIndex];

      if (existingLayer != null) {
        layers[existingLayerIndex] = update(existingLayer, { $merge: userLayer });
      } else {
        layers.push(userLayer);
      }
    }

    return layers;
  }

  shouldDisplaySegmentationData(): boolean {
    const currentViewMode = Store.getState().temporaryConfiguration.viewMode;
    // Currently segmentation data can only be displayed in orthogonal and volume mode
    const canModeDisplaySegmentationData = constants.MODES_PLANE.includes(currentViewMode);
    return this.getSegmentationBinary() != null && canModeDisplaySegmentationData;
  }

  canDisplaySegmentationData(): boolean {
    return getIntegerZoomStep(Store.getState()) <= 1;
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

  applyState(state: UrlManagerState, tracing: ServerTracing<SkeletonContentDataType | VolumeContentDataType>) {
    Store.dispatch(setPositionAction(state.position || tracing.content.editPosition));
    if (state.zoomStep != null) {
      Store.dispatch(setZoomStepAction(state.zoomStep));
    }

    const rotation = state.rotation || tracing.content.editRotation;
    if (rotation != null) {
      Store.dispatch(setRotationAction(rotation));
    }

    if (state.activeNode != null) {
      Store.dispatch(setActiveNodeAction(state.activeNode));
    }
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
    Store.dispatch(saveNowAction());
    while (!this.stateSaved()) {
      await Utils.sleep(500);
    }
  };
}

// export the model as a singleton
export default new OxalisModel();
