// @flow

import type { Vector3 } from "oxalis/constants";
import { getLayerBoundaries, getResolutionInfo } from "oxalis/model/accessors/dataset_accessor";
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
  mappings: ?Mappings;
  layerRenderingManager: LayerRenderingManager;
  resolutions: Array<Vector3>;
  fallbackLayer: ?string;
  fallbackLayerInfo: ?DataLayerType;
  isSegmentation: boolean;

  constructor(
    layerInfo: DataLayerType,
    connectionInfo: ConnectionInfo,
    textureWidth: number,
    dataTextureCount: number,
  ) {
    this.connectionInfo = connectionInfo;
    this.name = layerInfo.name;
    this.fallbackLayer = layerInfo.fallbackLayer != null ? layerInfo.fallbackLayer : null;
    this.fallbackLayerInfo =
      layerInfo.fallbackLayerInfo != null ? layerInfo.fallbackLayerInfo : null;
    this.isSegmentation = layerInfo.category === "segmentation";

    this.resolutions = layerInfo.resolutions;

    const { dataset } = Store.getState();

    ErrorHandling.assert(this.resolutions.length > 0, "Resolutions for layer cannot be empty");

    this.cube = new DataCube(
      getLayerBoundaries(dataset, this.name).upperBoundary,
      getResolutionInfo(this.resolutions),
      layerInfo.elementClass,
      this.isSegmentation,
      this.name,
    );

    this.pullQueue = new PullQueue(
      this.cube,
      layerInfo.name,
      this.connectionInfo,
      dataset.dataStore,
    );
    this.pushQueue = new PushQueue(this.cube);
    this.cube.initializeWithQueues(this.pullQueue, this.pushQueue);
    if (this.isSegmentation) this.mappings = new Mappings(layerInfo.name);
    this.layerRenderingManager = new LayerRenderingManager(
      this.name,
      this.pullQueue,
      this.cube,
      textureWidth,
      dataTextureCount,
    );
  }
}

export default DataLayer;
