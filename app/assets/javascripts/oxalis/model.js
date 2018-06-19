/**
 * model.js
 * @flow
 */
import _ from "lodash";
import Store from "oxalis/store";
import type { TracingTypeTracingType } from "oxalis/store";
import {} from "oxalis/model/actions/settings_actions";
import { saveNowAction } from "oxalis/model/actions/save_actions";
import Utils from "libs/utils";
import DataLayer from "oxalis/model/data_layer";
import ConnectionInfo from "oxalis/model/data_connection_info";
import type { ControlModeType } from "oxalis/constants";
import type DataCube from "oxalis/model/bucket_data_handling/data_cube";
import type PullQueue from "oxalis/model/bucket_data_handling/pullqueue";
import { getLayerByName } from "oxalis/model/accessors/dataset_accessor";
import { initialize } from "./model_initialization";

// TODO: Non-reactive
export class OxalisModel {
  connectionInfo: ConnectionInfo;
  dataLayers: {
    [key: string]: DataLayer,
  };
  isMappingSupported: boolean = true;
  maximumDataTextureCountForLayer: number;

  async fetch(
    tracingType: TracingTypeTracingType,
    annotationIdOrDatasetName: string,
    controlMode: ControlModeType,
    initialFetch: boolean,
  ) {
    const initializationInformation = await initialize(
      tracingType,
      annotationIdOrDatasetName,
      controlMode,
      initialFetch,
    );
    if (initializationInformation) {
      // Only executed on initial fetch
      const {
        dataLayers,
        connectionInfo,
        isMappingSupported,
        maximumDataTextureCountForLayer,
      } = initializationInformation;
      this.dataLayers = dataLayers;
      this.connectionInfo = connectionInfo;
      this.isMappingSupported = isMappingSupported;
      this.maximumDataTextureCountForLayer = maximumDataTextureCountForLayer;
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

  // todo: add ?DataLayer as return type
  getSegmentationLayer() {
    return _.find(
      this.dataLayers,
      dataLayer =>
        getLayerByName(Store.getState().dataset, dataLayer.name).category === "segmentation",
    );
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

  stateSaved() {
    const state = Store.getState();
    const storeStateSaved = !state.save.isBusy && state.save.queue.length === 0;
    const pushQueuesSaved = _.reduce(
      this.dataLayers,
      (saved, dataLayer) => saved && dataLayer.pushQueue.stateSaved(),
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

// export the model as a singleton
export default new OxalisModel();
