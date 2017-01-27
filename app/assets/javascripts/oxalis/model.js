/**
 * model.js
 * @flow weak
 */

import Backbone from "backbone";
import _ from "lodash";
import app from "app";
import Utils from "../libs/utils";
import Binary from "./model/binary";
import SkeletonTracing from "./model/skeletontracing/skeletontracing";
import User from "./model/user";
import DatasetConfiguration from "./model/dataset_configuration";
import VolumeTracing from "./model/volumetracing/volumetracing";
import ConnectionInfo from "./model/binarydata_connection_info";
import ScaleInfo from "./model/scaleinfo";
import Flycam2d from "./model/flycam2d";
import Flycam3d from "./model/flycam3d";
import constants from "./constants";
import type { ModeType, Vector3 } from "./constants";
import Request from "../libs/request";
import Toast from "../libs/toast";
import ErrorHandling from "../libs/error_handling";
import WkLayer from "./model/binary/layers/wk_layer";
import NdStoreLayer from "./model/binary/layers/nd_store_layer";

// This is THE model. It takes care of the data including the
// communication with the server.

// All public operations are **asynchronous**. We return a promise
// which you can react on.

export type BoundingBoxType = {
  min: Vector3,
  max: Vector3,
};
type Settings = {
  advancedOptionsAllowed: boolean,
  allowedModes: "orthogonal" | "oblique" | "flight" | "volume",
  branchPointsAllowed: boolean,
  somaClickingAllowed: boolean,
};
type Tracing = {
  actions: Array<any>,
  content: {
    boundingBox: {
      topLeft: Vector3,
      width: number,
      height: number,
      depth: number,
    },
    contentData: Object,
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
  restrictions: any,
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
  user: User;
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
  datasetConfiguration: DatasetConfiguration;
  tracing: Tracing;
  mode: ModeType;
  allowedModes: Array<ModeType>;
  settings: Settings;
  tracingId: string;
  tracingType: "Explorational" | "Task";

  constructor(...args) {
    super(...args);
    this.initialized = false;
  }


  fetch() {
    let infoUrl;
    if (this.get("controlMode") === constants.CONTROL_MODE_TRACE) {
      // Include /readOnly part whenever it is in the pathname
      infoUrl = `${location.pathname}/info`;
    } else {
      infoUrl = `/annotations/${this.tracingType}/${this.tracingId}/info`;
    }

    return Request.receiveJSON(infoUrl).then((tracing: Tracing) => {
      let error;
      if (tracing.error) {
        ({ error } = tracing);
      } else if (!tracing.content.dataSet) {
        error = "Selected dataset doesn't exist";
      } else if (!tracing.content.dataSet.dataLayers) {
        const datasetName = tracing.content.dataSet.name;
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

      this.user = new User();
      this.set("user", this.user);
      this.set("datasetName", tracing.content.dataSet.name);

      return this.user.fetch().then(() => Promise.resolve(tracing));
    },

    ).then((tracing: Tracing) => {
      this.set("dataset", new Backbone.Model(tracing.content.dataSet));
      const colorLayers = _.filter(this.get("dataset").get("dataLayers"),
                              layer => layer.category === "color");
      this.set("datasetConfiguration", new DatasetConfiguration({
        datasetName: this.get("datasetName"),
        dataLayerNames: _.map(colorLayers, "name"),
      }));
      return this.get("datasetConfiguration").fetch().then(() => Promise.resolve(tracing));
    },

    ).then((tracing: Tracing) => {
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
    const { dataStore } = tracing.content.dataSet;
    const dataset = this.get("dataset");

    const LayerClass = (() => {
      switch (dataStore.typ) {
        case "webknossos-store": return WkLayer;
        case "ndstore": return NdStoreLayer;
        default: throw new Error(`Unknown datastore type: ${dataStore.typ}`);
      }
    })();

    const layers = layerInfos.map(layerInfo => new LayerClass(layerInfo, dataset.get("name"), dataStore));

    ErrorHandling.assertExtendContext({
      task: this.get("tracingId"),
      dataSet: dataset.get("name"),
    });

    console.log("tracing", tracing);
    console.log("user", this.user);

    const isVolumeTracing = tracing.content.settings.allowedModes.includes("volume");
    app.scaleInfo = new ScaleInfo(dataset.get("scale"));

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
    const flycam3d = new Flycam3d(constants.DISTANCE_3D, dataset.get("scale"));
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
        this.set("skeletonTracing", new SkeletonTracing(tracing, flycam, flycam3d, this.user));
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


  getLayerInfos(userLayers) {
    // Overwrite or extend layers with userLayers

    const layers = this.get("dataset").get("dataLayers");
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


  canDisplaySegmentationData() {
    return !this.flycam.getIntegerZoomStep() > 0 || !this.getSegmentationBinary();
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
  save() {
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
      this.get("user").set("zoom", Math.exp(Math.LN2 * state.zoomStep));
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
