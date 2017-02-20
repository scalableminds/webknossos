/**
 * model.js
 * @flow weak
 */

import Backbone from "backbone";
import _ from "lodash";
import Store from "oxalis/store";
import { setDatasetAction, updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import Tracepoint from "oxalis/model/skeletontracing/tracepoint";
import window from "libs/window";
import Utils from "libs/utils";
import Binary from "oxalis/model/binary";
import SkeletonTracing from "oxalis/model/skeletontracing/skeletontracing";
import VolumeTracing from "oxalis/model/volumetracing/volumetracing";
import ConnectionInfo from "oxalis/model/binarydata_connection_info";
import scaleInfo from "oxalis/model/scaleinfo";
import Flycam2d from "oxalis/model/flycam2d";
import Flycam3d from "oxalis/model/flycam3d";
import constants from "oxalis/constants";
import type { ModeType, Vector3, Vector4 } from "oxalis/constants";
import Request from "libs/request";
import Toast from "libs/toast";
import ErrorHandling from "libs/error_handling";
import WkLayer from "oxalis/model/binary/layers/wk_layer";
import NdStoreLayer from "oxalis/model/binary/layers/nd_store_layer";

// This is THE model. It takes care of the data including the
// communication with the server.

// All public operations are **asynchronous**. We return a promise
// which you can react on.

export type BranchPoint = {
  id: number;
  timestamp: number;
}
export type BoundingBoxType = {
  min: Vector3,
  max: Vector3,
};
export type RestrictionsType = {
  allowAccess: boolean,
  allowUpdate: boolean,
  allowFinish: boolean,
  allowDownload: boolean,
};
type Settings = {
  advancedOptionsAllowed: boolean,
  allowedModes: "orthogonal" | "oblique" | "flight" | "volume",
  branchPointsAllowed: boolean,
  somaClickingAllowed: boolean,
};
export type CommentType = {
  node: number;
  comment: string;
};
export type TreeData = {
  id: number;
  color: Vector4;
  name: string;
  timestamp: number;
  comments: Array<CommentType>;
  branchPoints: Array<BranchPoint>;
  edges: Array<{source: number, target: number}>;
  nodes: Array<Tracepoint>;
};

export type BoundingBoxObjectType = {
  topLeft: Vector3,
  width: number,
  height: number,
  depth: number,
};

export type SkeletonContentDataType = {
  activeNode: null | number;
  trees: Array<TreeData>;
  zoomLevel: number;
  customLayers: null;
};

export type VolumeContentDataType = {
  activeCell: null | number;
  customLayers: Array<Object>;
  maxCoordinates: BoundingBoxObjectType;
  customLayers: ?Array<Object>;
  name: string;
};

export type Tracing = {
  actions: Array<any>,
  content: {
    boundingBox: BoundingBoxObjectType,
    contentData: VolumeContentDataType | SkeletonContentDataType,
    contentType: string,
    dataSet: Object,
    editPosition: Vector3,
    editRotation: Vector3,
    settings: Settings,
  },
  contentType: string,
  created: string,
  dataSetName: string,
  downloadUrl: string,
  formattedHash: string,
  id: string,
  name: string,
  restrictions: RestrictionsType,
  state: any,
  stateLabel: string,
  stats: any,
  task: any,
  tracingTime: number,
  typ: string,
  user: any,
  version: number,
};

class Model extends Backbone.Model {
  HANDLED_ERROR = "error_was_handled";

  initialized: boolean;
  connectionInfo: ConnectionInfo;
  binary: {
    [key: string]: Binary,
  };
  taskBoundingBox: BoundingBoxType;
  userBoundingBox: BoundingBoxType;
  annotationModel: SkeletonTracing | VolumeTracing;
  lowerBoundary: Vector3;
  upperBoundary: Vector3;
  flycam: Flycam2d;
  flycam3d: Flycam3d;
  volumeTracing: VolumeTracing;
  skeletonTracing: SkeletonTracing;
  tracing: Tracing;
  mode: ModeType;
  allowedModes: Array<ModeType>;
  settings: Settings;
  tracingId: string;
  tracingType: "Explorational" | "Task" | "View";

  constructor(...args) {
    super(...args);
    this.initialized = false;
  }


  fetch() {
    let infoUrl;
    if (this.get("controlMode") === constants.CONTROL_MODE_TRACE) {
      // Include /readOnly part whenever it is in the pathname
      infoUrl = `${window.location.pathname}/info`;
    } else {
      infoUrl = `/annotations/${this.get("tracingType")}/${this.get("tracingId")}/info`;
    }

    return Request.receiveJSON(infoUrl).then((tracing: Tracing) => {
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
      return tracing;
    }).then((tracing: Tracing) => {
      const layerInfos = this.getLayerInfos(tracing.content.contentData.customLayers);
      return this.initializeWithData(tracing, layerInfos);
    },

    );
  }


  determineAllowedModes() {
    const allowedModes = [];
    const settings = this.get("settings");
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
        this.set("preferredMode", modeId);
      }
    }

    allowedModes.sort();
    return allowedModes;
  }


  initializeWithData(tracing: Tracing, layerInfos) {
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
      task: this.get("tracingId"),
      dataSet: dataset.name,
    });

    const isVolumeTracing = tracing.content.settings.allowedModes.includes("volume");
    scaleInfo.initialize(dataset.scale);

    const bb = tracing.content.boundingBox;
    if (bb != null) {
      this.taskBoundingBox = this.computeBoundingBoxFromArray(bb.topLeft.concat([bb.width, bb.height, bb.depth]));
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

    const flycam = new Flycam2d(constants.PLANE_WIDTH, maxZoomStep + 1, this);
    const flycam3d = new Flycam3d(constants.DISTANCE_3D, dataset.scale);
    this.set("flycam", flycam);
    this.set("flycam3d", flycam3d);
    this.listenTo(flycam3d, "changed", matrix => flycam.setPosition(matrix.slice(12, 15)));
    this.listenTo(flycam, "positionChanged", position => flycam3d.setPositionSilent(position));

    if (this.get("controlMode") === constants.CONTROL_MODE_TRACE) {
      if (isVolumeTracing) {
        ErrorHandling.assert((this.getSegmentationBinary() != null),
          "Volume is allowed, but segmentation does not exist");
        this.set("volumeTracing", new VolumeTracing(tracing, flycam, flycam3d, this.getSegmentationBinary()));
        this.annotationModel = this.get("volumeTracing");
      } else {
        this.set("skeletonTracing", new SkeletonTracing(tracing, flycam, flycam3d));
        this.annotationModel = this.get("skeletonTracing");
      }
    }

    this.applyState(this.get("state"), tracing);
    this.computeBoundaries();

    this.set("tracing", tracing);
    this.set("flightmodeRecording", false);
    this.set("settings", tracing.content.settings);
    this.set("allowedModes", this.determineAllowedModes());
    this.set("isTask", this.get("tracingType") === "Task");

    // Initialize 'flight', 'oblique' or 'orthogonal'/'volume' mode
    if (this.get("allowedModes").length === 0) {
      Toast.error("There was no valid allowed tracing mode specified.");
    } else {
      const mode = this.get("preferredMode") || this.get("state").mode || this.get("allowedModes")[0];
      this.setMode(mode);
    }


    this.initSettersGetter();
    this.initialized = true;
    this.trigger("sync");

    // no error
  }


  setMode(mode: ModeType) {
    this.set("mode", mode);
    this.trigger("change:mode", mode);
  }


  setUserBoundingBox(bb: Array<number>) {
    this.userBoundingBox = this.computeBoundingBoxFromArray(bb);
    this.trigger("change:userBoundingBox", this.userBoundingBox);
  }


  computeBoundingBoxFromArray(bb: Array<number>): BoundingBoxType {
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


  getBinaryByName(name) {
    return this.binary[name];
  }


  getLayerInfos(userLayers) {
    // Overwrite or extend layers with userLayers

    const layers = Store.getState().dataset.dataLayers;
    if (userLayers == null) { return layers; }

    for (const userLayer of userLayers) {
      const existingLayer = _.find(layers, layer => layer.name === Utils.__guard__(userLayer.fallback, x => x.layerName));

      if (existingLayer != null) {
        _.extend(existingLayer, userLayer);
      } else {
        layers.push(userLayer);
      }
    }

    return layers;
  }


  canDisplaySegmentationData(): boolean {
    return !(this.flycam.getIntegerZoomStep() > 0) || !this.getSegmentationBinary();
  }


  computeBoundaries() {
    this.lowerBoundary = [Infinity, Infinity, Infinity];
    this.upperBoundary = [-Infinity, -Infinity, -Infinity];

    for (const key of Object.keys(this.binary)) {
      const binary = this.binary[key];
      for (let i = 0; i <= 2; i++) {
        this.lowerBoundary[i] = Math.min(this.lowerBoundary[i], binary.lowerBoundary[i]);
        this.upperBoundary[i] = Math.max(this.upperBoundary[i], binary.upperBoundary[i]);
      }
    }
  }

  // delegate save request to all submodules
  save = function save() {
    const submodels = [];
    const promises = [];

    if (this.get("volumeTracing") != null) {
      submodels.push(this.get("volumeTracing").stateLogger);
    }

    if (this.get("skeletonTracing") != null) {
      submodels.push(this.get("skeletonTracing").stateLogger);
    }

    _.each(submodels, model => promises.push(model.save()));

    return Promise.all(promises).then(
      (...args) => {
        Toast.success("Saved!");
        return Promise.resolve(...args);
      },
      (...args) => {
        Toast.error("Couldn't save. Please try again.");
        return Promise.reject(...args);
      });
  }


  // Make the Model compatible between legacy Oxalis style and Backbone.Models/Views
  initSettersGetter() {
    _.forEach(this.attributes, (value, key) => Object.defineProperty(this, key, {
      set(val) {
        return this.set(key, val);
      },
      get() {
        return this.get(key);
      },
    },
      ),
    );
  }


  applyState(state, tracing) {
    this.get("flycam").setPosition(state.position || tracing.content.editPosition);
    if (state.zoomStep != null) {
      _.defer(() => {
        Store.dispatch(updateUserSettingAction("zoom", Math.exp(Math.LN2 * state.zoomStep)));
      });
      this.get("flycam3d").setZoomStep(state.zoomStep);
    }

    const rotation = state.rotation || tracing.content.editRotation;
    if (rotation != null) {
      this.get("flycam3d").setRotation(rotation);
    }

    if (state.activeNode != null) {
      Utils.__guard__(this.get("skeletonTracing"), x => x.setActiveNode(state.activeNode));
    }
  }
}

export default Model;
