// @flow

import type { ProgressCallback } from "libs/progress_callback";
import type { Vector3 } from "oxalis/constants";
import {
  getLayerByName,
  getLayerBoundaries,
  getBitDepth,
} from "oxalis/model/accessors/dataset_accessor";
import ConnectionInfo from "oxalis/model/data_connection_info";
import DataCube from "oxalis/model/bucket_data_handling/data_cube";
import ErrorHandling from "libs/error_handling";
import LayerRenderingManager from "oxalis/model/bucket_data_handling/layer_rendering_manager";
import Mappings from "oxalis/model/bucket_data_handling/mappings";
import PullQueue from "oxalis/model/bucket_data_handling/pullqueue";
import PushQueue from "oxalis/model/bucket_data_handling/pushqueue";
import Store, { type DataLayerType } from "oxalis/store";

// TODO: Non-reactive
class DataLayer {
  cube: DataCube;
  name: string;
  connectionInfo: ConnectionInfo;
  pullQueue: PullQueue;
  pushQueue: PushQueue;
  mappings: Mappings;
  activeMapping: ?string;
  layerRenderingManager: LayerRenderingManager;
  resolutions: Array<Vector3>;

  constructor(
    layerInfo: DataLayerType,
    connectionInfo: ConnectionInfo,
    textureWidth: number,
    dataTextureCount: number,
  ) {
    this.connectionInfo = connectionInfo;
    this.name = layerInfo.name;
    this.resolutions = layerInfo.resolutions;

    const { dataset } = Store.getState();
    const bitDepth = getBitDepth(getLayerByName(dataset, this.name));

    ErrorHandling.assert(this.resolutions.length > 0, "Resolutions for layer cannot be empty");

    this.cube = new DataCube(
      getLayerBoundaries(dataset, this.name).upperBoundary,
      this.resolutions.length,
      bitDepth,
      layerInfo.category === "segmentation",
    );

    this.pullQueue = new PullQueue(
      this.cube,
      layerInfo.name,
      this.connectionInfo,
      dataset.dataStore,
    );
    this.pushQueue = new PushQueue(this.cube);
    this.cube.initializeWithQueues(this.pullQueue, this.pushQueue);
    this.mappings = new Mappings(layerInfo.name);
    this.activeMapping = null;
    this.layerRenderingManager = new LayerRenderingManager(
      this.name,
      this.pullQueue,
      this.cube,
      textureWidth,
      dataTextureCount,
      layerInfo.category === "segmentation",
    );
  }

  setActiveMapping(mappingName: ?string, progressCallback?: ProgressCallback): void {
    this.activeMapping = mappingName;
    this.mappings.activateMapping(mappingName, progressCallback);
  }
}

export default DataLayer;
