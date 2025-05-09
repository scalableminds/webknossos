import ErrorHandling from "libs/error_handling";
import type { Vector3 } from "viewer/constants";
import { getLayerBoundingBox, getMagInfo } from "viewer/model/accessors/dataset_accessor";
import DataCube from "viewer/model/bucket_data_handling/data_cube";
import LayerRenderingManager from "viewer/model/bucket_data_handling/layer_rendering_manager";
import Mappings from "viewer/model/bucket_data_handling/mappings";
import PullQueue from "viewer/model/bucket_data_handling/pullqueue";
import PushQueue from "viewer/model/bucket_data_handling/pushqueue";
import type { DataLayerType } from "viewer/store";
import Store from "viewer/store";

class DataLayer {
  cube: DataCube;
  name: string;
  pullQueue: PullQueue;
  pushQueue: PushQueue;
  mappings: Mappings | null | undefined;
  layerRenderingManager: LayerRenderingManager;
  mags: Array<Vector3>;
  fallbackLayer: string | null | undefined;
  fallbackLayerInfo: DataLayerType | null | undefined;
  isSegmentation: boolean;

  constructor(
    layerInfo: DataLayerType,
    textureWidth: number,
    dataTextureCount: number,
    tracingId: string,
  ) {
    this.name = layerInfo.name;
    this.fallbackLayer =
      "fallbackLayer" in layerInfo && layerInfo.fallbackLayer != null
        ? layerInfo.fallbackLayer
        : null;
    this.fallbackLayerInfo =
      "fallbackLayerInfo" in layerInfo && layerInfo.fallbackLayerInfo != null
        ? layerInfo.fallbackLayerInfo
        : null;
    this.isSegmentation = layerInfo.category === "segmentation";
    this.mags = layerInfo.resolutions;

    const { dataset } = Store.getState();
    ErrorHandling.assert(this.mags.length > 0, "Magnifications for layer cannot be empty");

    this.cube = new DataCube(
      getLayerBoundingBox(dataset, this.name),
      layerInfo.additionalAxes || [],
      getMagInfo(this.mags),
      layerInfo.elementClass,
      this.isSegmentation,
      this.name,
    );
    this.pullQueue = new PullQueue(this.cube, layerInfo.name, dataset.dataStore);
    this.pushQueue = new PushQueue(this.cube, tracingId);
    this.cube.initializeWithQueues(this.pullQueue, this.pushQueue);

    if (this.isSegmentation) {
      this.mappings = new Mappings(layerInfo.name);
    }

    this.layerRenderingManager = new LayerRenderingManager(
      this.name,
      this.pullQueue,
      this.cube,
      textureWidth,
      dataTextureCount,
    );
  }

  destroy() {
    this.pullQueue.clear();
    this.pushQueue.clear();
    this.layerRenderingManager.destroy();
    this.cube.destroy();
    if (this.mappings) {
      this.mappings.destroy();
    }
  }
}

export default DataLayer;
