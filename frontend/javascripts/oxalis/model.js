/**
 * model.js
 * @flow
 */
import {} from "oxalis/model/actions/settings_actions";

import _ from "lodash";

import type { Versions } from "oxalis/view/version_view";
import { getLayerByName } from "oxalis/model/accessors/dataset_accessor";
import { isBusy } from "oxalis/model/accessors/save_accessor";
import { saveNowAction } from "oxalis/model/actions/save_actions";
import ConnectionInfo from "oxalis/model/data_connection_info";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import DataLayer from "oxalis/model/data_layer";
import type LayerRenderingManager from "oxalis/model/bucket_data_handling/layer_rendering_manager";
import type PullQueue from "oxalis/model/bucket_data_handling/pullqueue";
import Store, { type TraceOrViewCommand, type AnnotationType } from "oxalis/store";
import * as Utils from "libs/utils";

import { initialize } from "./model_initialization";

// TODO: Non-reactive
export class OxalisModel {
  connectionInfo: ConnectionInfo;
  dataLayers: {
    [key: string]: DataLayer,
  };

  isMappingSupported: boolean = true;
  maximumTextureCountForLayer: number;

  async fetch(
    annotationType: AnnotationType,
    initialCommandType: TraceOrViewCommand,
    initialFetch: boolean,
    versions?: Versions,
  ) {
    const initializationInformation = await initialize(
      annotationType,
      initialCommandType,
      initialFetch,
      versions,
    );
    if (initializationInformation) {
      // Only executed on initial fetch
      const {
        dataLayers,
        connectionInfo,
        isMappingSupported,
        maximumTextureCountForLayer,
      } = initializationInformation;
      this.dataLayers = dataLayers;
      this.connectionInfo = connectionInfo;
      this.isMappingSupported = isMappingSupported;
      this.maximumTextureCountForLayer = maximumTextureCountForLayer;
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

  // Todo: Make return type optional
  getSegmentationLayer(): DataLayer {
    return _.find(
      this.dataLayers,
      dataLayer =>
        getLayerByName(Store.getState().dataset, dataLayer.name).category === "segmentation",
    );
  }

  getSegmentationLayerName(): ?string {
    const segmentation = this.getSegmentationLayer();
    return segmentation != null ? segmentation.name : undefined;
  }

  getCubeByLayerName(name: string): DataCube {
    if (!this.dataLayers[name]) {
      throw new Error(`Layer with name ${name} was not found.`);
    }
    return this.dataLayers[name].cube;
  }

  getPullQueueByLayerName(name: string): PullQueue {
    if (!this.dataLayers[name]) {
      throw new Error(`Layer with name ${name} was not found.`);
    }
    return this.dataLayers[name].pullQueue;
  }

  getLayerRenderingManagerByName(name: string): LayerRenderingManager {
    if (!this.dataLayers[name]) {
      throw new Error(`Layer with name ${name} was not found.`);
    }
    return this.dataLayers[name].layerRenderingManager;
  }

  stateSaved() {
    const state = Store.getState();
    const storeStateSaved =
      !isBusy(state.save.isBusyInfo) &&
      state.save.queue.skeleton.length + state.save.queue.volume.length === 0;
    const pushQueuesSaved = _.reduce(
      this.dataLayers,
      (saved, dataLayer) => saved && dataLayer.pushQueue.stateSaved(),
      true,
    );
    return storeStateSaved && pushQueuesSaved;
  }

  forceSave = () => {
    // In contrast to the save function, this method will trigger exactly one saveNowAction
    // regardless of what the current save state is
    // This will force a new save try, even if the save saga is currently waiting to retry the save request
    Store.dispatch(saveNowAction());
  };

  ensureSavedState = async () => {
    // This function will only return once all state is saved
    // even if new updates are pushed to the save queue during saving
    while (!this.stateSaved()) {
      // The dispatch of the saveNowAction IN the while loop is deliberate.
      // Otherwise if an update action is pushed to the save queue during the Utils.sleep,
      // the while loop would continue running until the next save would be triggered.
      if (!isBusy(Store.getState().save.isBusyInfo)) {
        Store.dispatch(saveNowAction());
      }
      // eslint-disable-next-line no-await-in-loop
      await Utils.sleep(500);
    }
  };
}

const model = new OxalisModel();

// export the model as a singleton
export default model;
