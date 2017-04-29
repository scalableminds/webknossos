/**
 * model.js
 * @flow
 */

import Backbone from "backbone";
import type { Attrs, ModelOpts } from "backbone";
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
  DataLayerType,
  AllowedModeType,
} from "oxalis/store";
import type { UrlManagerState } from "oxalis/controller/url_manager";
import { setDatasetAction } from "oxalis/model/actions/settings_actions";
import { setActiveNodeAction, initializeSkeletonTracingAction, setViewModeAction } from "oxalis/model/actions/skeletontracing_actions";
import { initializeVolumeTracingAction } from "oxalis/model/actions/volumetracing_actions";
import { setTaskAction } from "oxalis/model/actions/task_actions";
import { setPositionAction, setZoomStepAction, setRotationAction } from "oxalis/model/actions/flycam_actions";
import { saveNowAction } from "oxalis/model/actions/save_actions";
import window from "libs/window";
import Utils from "libs/utils";
import Binary from "oxalis/model/binary";
import ConnectionInfo from "oxalis/model/binarydata_connection_info";
import { getIntegerZoomStep } from "oxalis/model/accessors/flycam_accessor";
import constants, { Vector3Indicies } from "oxalis/constants";
import type { ModeType, Vector3, Vector6 } from "oxalis/constants";
import Request from "libs/request";
import Toast from "libs/toast";
import ErrorHandling from "libs/error_handling";
import WkLayer from "oxalis/model/binary/layers/wk_layer";
import NdStoreLayer from "oxalis/model/binary/layers/nd_store_layer";
import update from "immutability-helper";

// This is THE model. It takes care of the data including the
// communication with the server.

// All public operations are **asynchronous**. We return a promise
// which you can react on.

export type BoundingBoxType = {
  min: Vector3,
  max: Vector3,
};

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
};

export type VolumeContentDataType = {
  activeCell: null | number;
  nextCell: ?number,
  customLayers: Array<Object>;
  maxCoordinates: BoundingBoxObjectType;
  name: string;
};

export type Tracing<T> = {
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
  task: any,
  tracingTime: number,
  typ: SkeletonTracingTypeTracingType | VolumeTracingTypeTracingType,
  user: any,
  version: number,
};

// TODO: Non-reactive
class Model extends Backbone.Model {
  HANDLED_ERROR = "error_was_handled";

  initialized: boolean;
  connectionInfo: ConnectionInfo;
  binary: {
    [key: string]: Binary,
  };
  taskBoundingBox: BoundingBoxType;
  userBoundingBox: BoundingBoxType;
  lowerBoundary: Vector3;
  upperBoundary: Vector3;
  allowedModes: Array<ModeType>;
  isVolume: boolean;
  settings: SettingsType;
  tracing: Tracing<SkeletonContentDataType | VolumeContentDataType>;
  tracingId: string;
  tracingType: "Explorational" | "Task" | "View";
  controlMode: mixed;
  preferredMode: ModeType;
  flightmodeRecording: mixed;
  isTask: boolean;
  state: UrlManagerState;

  // Let's get rid of model attributes and enforce it by deleting these methods:
  // let's keep this in here for some time. Otherwise, merging it
  // with old usages won't raise flow errors
  // $FlowFixMe
  set: null; get: null;

  constructor(attributes?: Attrs, options?: ModelOpts) {
    super(attributes, options);
    this.initialized = false;
    // Unpack the properties manually:
    // $FlowFixMe
    this.tracingType = attributes.tracingType;
    // $FlowFixMe
    this.tracingId = attributes.tracingId;
    // $FlowFixMe
    this.controlMode = attributes.controlMode;
  }


  fetch() {
    let infoUrl;
    if (this.controlMode === constants.CONTROL_MODE_TRACE) {
      // Include /readOnly part whenever it is in the pathname
      infoUrl = `${window.location.pathname}/info`;
    } else {
      infoUrl = `/annotations/${this.tracingType}/${this.tracingId}/info`;
    }

    return Request.receiveJSON(infoUrl).then((tracing: Tracing<*>) => {
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

      Store.dispatch(setDatasetAction(dataset));
      Store.dispatch(setTaskAction(tracing.task));
      return tracing;
    }).then((tracing: Tracing<*>) => {
      const layerInfos = this.getLayerInfos(tracing.content.contentData.customLayers);
      return this.initializeWithData(tracing, layerInfos);
    });
  }


  determineAllowedModes() {
    const allowedModes = [];
    const settings = this.settings;
    for (const allowedMode of settings.allowedModes) {
      if (this.getColorBinaries()[0].cube.BIT_DEPTH === 8) {
        switch (allowedMode) {
          case "flight": allowedModes.push(constants.MODE_ARBITRARY); break;
          case "oblique": allowedModes.push(constants.MODE_ARBITRARY_PLANE); break;
          default: // ignore other modes for now
        }
      }

      if (["orthogonal", "volume"].includes(allowedMode)) {
        allowedModes.push(constants.MODE_NAME_TO_ID[allowedMode]);
      }
    }

    if (settings.preferredMode) {
      const modeId = constants.MODE_NAME_TO_ID[settings.preferredMode];
      if (allowedModes.includes(modeId)) {
        this.preferredMode = modeId;
      }
    }

    allowedModes.sort();
    return allowedModes;
  }

  initializeWithData(tracing: Tracing<SkeletonContentDataType | VolumeContentDataType>, layerInfos: Array<DataLayerType>) {
    const dataset = tracing.content.dataSet;
    const { dataStore } = dataset;

    const LayerClass = (() => {
      switch (dataStore.typ) {
        case "webknossos-store": return WkLayer;
        case "ndstore": return NdStoreLayer;
        default: throw new Error(`Unknown datastore type: ${dataStore.typ}`);
      }
    })();

    const layers = layerInfos.map(layerInfo => new LayerClass(layerInfo, dataStore));

    ErrorHandling.assertExtendContext({
      task: this.tracingId,
      dataSet: dataset.name,
    });

    const bb = tracing.content.boundingBox;
    if (bb != null) {
      this.taskBoundingBox = this.computeBoundingBoxFromArray(Utils.concatVector3(bb.topLeft, [bb.width, bb.height, bb.depth]));
    }

    this.connectionInfo = new ConnectionInfo();
    this.binary = {};

    let maxZoomStep = -Infinity;

    for (const layer of layers) {
      const maxLayerZoomStep = Math.log(Math.max(...layer.resolutions)) / Math.LN2;
      this.binary[layer.name] = new Binary(this, tracing, layer, maxLayerZoomStep, this.connectionInfo);
      maxZoomStep = Math.max(maxZoomStep, maxLayerZoomStep);
    }

    this.buildMappingsObject();

    if (this.getColorBinaries().length === 0) {
      Toast.error("No data available! Something seems to be wrong with the dataset.");
      throw this.HANDLED_ERROR;
    }

    this.isVolume = tracing.content.settings.allowedModes.includes("volume");

    if (this.controlMode === constants.CONTROL_MODE_TRACE) {
      if (this.isVolumeTracing()) {
        ErrorHandling.assert((this.getSegmentationBinary() != null),
          "Volume is allowed, but segmentation does not exist");
        // $FlowFixMe
        const volumeTracing: Tracing<VolumeContentDataType> = tracing;
        Store.dispatch(initializeVolumeTracingAction(volumeTracing));
      } else {
        // $FlowFixMe
        const skeletonTracing: Tracing<SkeletonContentDataType> = tracing;
        Store.dispatch(initializeSkeletonTracingAction(skeletonTracing));
      }
    }

    this.applyState(this.state, tracing);
    this.computeBoundaries();

    this.tracing = tracing;
    this.flightmodeRecording = false;
    this.settings = tracing.content.settings;
    this.allowedModes = this.determineAllowedModes();
    this.isTask = this.tracingType === "Task";

    // Initialize 'flight', 'oblique' or 'orthogonal'/'volume' mode
    if (this.allowedModes.length === 0) {
      Toast.error("There was no valid allowed tracing mode specified.");
    } else {
      const mode = this.preferredMode || this.state.mode || this.allowedModes[0];
      Store.dispatch(setViewModeAction(mode));
    }


    this.initialized = true;
    this.trigger("sync");

    // no error
  }

  setUserBoundingBox(bb: Vector6) {
    this.userBoundingBox = this.computeBoundingBoxFromArray(bb);
    this.trigger("change:userBoundingBox", this.userBoundingBox);
  }


  computeBoundingBoxFromArray(bb: Vector6): BoundingBoxType {
    const [x, y, z, width, height, depth] = bb;

    return {
      min: [x, y, z],
      max: [x + width, y + height, z + depth],
    };
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


  isVolumeTracing() {
    return this.isVolume;
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


  canDisplaySegmentationData(): boolean {
    return !(getIntegerZoomStep(Store.getState()) > 1) || !this.getSegmentationBinary();
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

  applyState(state: UrlManagerState, tracing: Tracing<SkeletonContentDataType | VolumeContentDataType>) {
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

export default Model;
