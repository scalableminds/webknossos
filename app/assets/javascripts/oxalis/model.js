/**
 * model.js
 * @flow
 */

import _ from "lodash";
import Store from "oxalis/store";
import type {
  BoundingBoxObjectType,
  SettingsType,
  NodeType,
  EdgeType,
  CommentType,
  BranchPointType,
  SegmentationDataLayerType,
  TracingTypeTracingType,
} from "oxalis/store";
import type { UrlManagerState } from "oxalis/controller/url_manager";
import {
  setDatasetAction,
  setViewModeAction,
  setControlModeAction,
} from "oxalis/model/actions/settings_actions";
import {
  setActiveNodeAction,
  initializeSkeletonTracingAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { initializeVolumeTracingAction } from "oxalis/model/actions/volumetracing_actions";
import { initializeReadOnlyTracingAction } from "oxalis/model/actions/readonlytracing_actions";
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
import type { APIDatasetType, APIAnnotationType } from "admin/api_flow_types";

type ServerSkeletonTracingTreeType = {
  treeId: number,
  color: ?Vector3,
  name: string,
  timestamp: number,
  comments: Array<CommentType>,
  branchPoints: Array<BranchPointType>,
  edges: Array<EdgeType>,
  nodes: Array<NodeType>,
};

type ServerTracingBaseType = {
  boundingBox?: BoundingBoxObjectType,
  editPosition: Vector3,
  editRotation: Vector3,
  version: number,
  zoomLevel: number,
};

export type ServerSkeletonTracingType = ServerTracingBaseType & {
  activeNodeId?: number,
  trees: Array<ServerSkeletonTracingTreeType>,
};

export type ServerVolumeTracingType = ServerTracingBaseType & {
  activeSegmentId?: number,
  dataLayer: SegmentationDataLayerType,
  fallbackLayer?: string,
};

type ServerTracingType = ServerSkeletonTracingType | ServerVolumeTracingType;

// TODO: Non-reactive
export class OxalisModel {
  HANDLED_ERROR = "error_was_handled";

  connectionInfo: ConnectionInfo;
  binary: {
    [key: string]: Binary,
  };
  lowerBoundary: Vector3;
  upperBoundary: Vector3;

  async fetch(
    tracingType: TracingTypeTracingType,
    annotationId: string,
    controlMode: ControlModeType,
    initialFetch: boolean,
  ) {
    Store.dispatch(setControlModeAction(controlMode));

    let infoUrl;
    if (controlMode === ControlModeEnum.TRACE) {
      // Include /readOnly part whenever it is in the pathname
      const isReadOnly = window.location.pathname.endsWith("/readOnly");
      const readOnlyPart = isReadOnly ? "readOnly/" : "";
      infoUrl = `/annotations/${tracingType}/${annotationId}/${readOnlyPart}info`;
    } else {
      infoUrl = `/annotations/${tracingType}/${annotationId}/info`;
    }

    const annotation: APIAnnotationType = await Request.receiveJSON(infoUrl);
    const dataset: APIDatasetType = await Request.receiveJSON(
      `/api/datasets/${annotation.dataSetName}`,
    );

    let error;
    if (annotation.error) {
      ({ error } = annotation);
    } else if (!dataset) {
      error = "Selected dataset doesn't exist";
    } else if (!dataset.dataSource.dataLayers) {
      const datasetName = annotation.dataSetName;
      if (datasetName) {
        error = `Please, double check if you have the dataset '${datasetName}' imported.`;
      } else {
        error = "Please, make sure you have a dataset imported.";
      }
    }

    if (error) {
      Toast.error(error);
      throw this.HANDLED_ERROR;
    }

    if (!annotation.restrictions.allowAccess) {
      error = "You are not allowed to access this tracing";
      throw this.HANDLED_ERROR;
    }

    // Make sure subsequent fetch calls are always for the same dataset
    if (!_.isEmpty(this.binary)) {
      ErrorHandling.assert(
        _.isEqual(dataset, Store.getState().dataset),
        "Model.fetch was called for a task with another dataset, without reloading the page.",
      );
    }

    ErrorHandling.assertExtendContext({
      task: annotation.id,
      dataSet: dataset.dataSource.id.name,
    });

    Store.dispatch(setDatasetAction(dataset));
    Store.dispatch(setTaskAction(annotation.task));

    // Fetch the actual tracing from the datastore
    const tracing = await Request.receiveJSON(
      `${annotation.dataStore.url}/data/tracings/${annotation.content.typ}/${annotation.content
        .id}`,
    );

    // Only initialize the model once.
    // There is no need to reinstantiate the binaries if the dataset didn't change.
    if (initialFetch) {
      this.initializeModel(annotation, tracing, dataset);
    }
    this.initializeTracing(annotation, tracing, initialFetch);

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

  initializeTracing(
    annotation: APIAnnotationType,
    tracing: ServerTracingType,
    initialFetch: boolean,
  ) {
    const { allowedModes, preferredMode } = this.determineAllowedModes(annotation.settings);
    _.extend(annotation.settings, { allowedModes, preferredMode });

    const isVolume = annotation.content.typ === "volume";
    const controlMode = Store.getState().temporaryConfiguration.controlMode;
    if (controlMode === ControlModeEnum.TRACE) {
      if (isVolume) {
        ErrorHandling.assert(
          this.getSegmentationBinary() != null,
          "Volume is allowed, but segmentation does not exist",
        );
        const volumeTracing: ServerVolumeTracingType = (tracing: any);
        Store.dispatch(initializeVolumeTracingAction(annotation, volumeTracing));
      } else {
        const skeletonTracing: ServerSkeletonTracingType = (tracing: any);
        Store.dispatch(initializeSkeletonTracingAction(annotation, skeletonTracing));
      }
    } else {
      const readOnlyTracing: ServerSkeletonTracingType = (tracing: any);
      Store.dispatch(initializeReadOnlyTracingAction(annotation, readOnlyTracing));
    }

    if (initialFetch) {
      // TODO remove default value
      Store.dispatch(setZoomStepAction(tracing.zoomLevel != null ? tracing.zoomLevel : 2));
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

  initializeModel(
    annotation: APIAnnotationType,
    tracing: ServerTracingType,
    dataset: APIDatasetType,
  ) {
    const { dataStore } = dataset;

    const LayerClass = (() => {
      switch (dataStore.typ) {
        case "webknossos-store":
          return WkLayer;
        case "ndstore":
          return NdStoreLayer;
        default:
          throw new Error(`Unknown datastore type: ${dataStore.typ}`);
      }
    })();

    const layers = this.getLayerInfos(tracing).map(
      layerInfo => new LayerClass(layerInfo, dataStore),
    );

    this.connectionInfo = new ConnectionInfo();
    this.binary = {};

    let maxZoomStep = -Infinity;

    for (const layer of layers) {
      const maxLayerZoomStep = Math.log(Math.max(...layer.resolutions)) / Math.LN2;
      this.binary[layer.name] = new Binary(
        annotation.content.typ,
        layer,
        maxLayerZoomStep,
        this.connectionInfo,
      );
      maxZoomStep = Math.max(maxZoomStep, maxLayerZoomStep);
    }

    this.buildMappingsObject();

    if (this.getColorBinaries().length === 0) {
      Toast.error("No data available! Something seems to be wrong with the dataset.");
      throw this.HANDLED_ERROR;
    }

    this.computeBoundaries();
  }

  // For now, since we have no UI for this
  buildMappingsObject() {
    const segmentationBinary = this.getSegmentationBinary();

    if (segmentationBinary != null) {
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

  getLayerInfos(tracing: ServerTracingType) {
    // Overwrite or extend layers with volumeTracingLayer

    const dataset = Store.getState().dataset;
    const layers = dataset == null ? [] : _.clone(dataset.dataLayers);
    if (tracing.dataLayer == null) {
      return layers;
    }

    const existingLayerIndex = _.findIndex(layers, layer => layer.name === tracing.fallbackLayer);
    const existingLayer = layers[existingLayerIndex];

    if (existingLayer != null) {
      layers[existingLayerIndex] = update(tracing.dataLayer, {
        $merge: { mappings: existingLayer.mappings },
      });
    } else {
      layers.push(tracing.dataLayer);
    }

    return layers;
  }

  shouldDisplaySegmentationData(): boolean {
    const segmentationOpacity = Store.getState().datasetConfiguration.segmentationOpacity;
    if (segmentationOpacity === 0) {
      return false;
    }
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

  applyState(state: UrlManagerState, tracing: ServerTracingType) {
    // TODO remove default value
    Store.dispatch(setPositionAction(state.position || tracing.editPosition || [0, 0, 0]));
    if (state.zoomStep != null) {
      Store.dispatch(setZoomStepAction(state.zoomStep));
    }
    // TODO remove default value
    const rotation = state.rotation || tracing.editRotation || [0, 0, 0];
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
      // eslint-disable-next-line no-await-in-loop
      await Utils.sleep(500);
    }
  };
}

// export the model as a singleton
export default new OxalisModel();
