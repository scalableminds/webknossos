import { isDatasetAccessibleBySwitching } from "admin/rest_api";
import * as Utils from "libs/utils";
import _ from "lodash";
import type { APICompoundType } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import {
  getLayerByName,
  getSegmentationLayerWithMappingSupport,
  isLayerVisible,
} from "viewer/model/accessors/dataset_accessor";
import { getActiveMagIndexForLayer } from "viewer/model/accessors/flycam_accessor";
import { getActiveSegmentationTracingLayer } from "viewer/model/accessors/volumetracing_accessor";
import {
  ensureTracingsWereDiffedToSaveQueueAction,
  saveNowAction,
} from "viewer/model/actions/save_actions";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import type LayerRenderingManager from "viewer/model/bucket_data_handling/layer_rendering_manager";
import type PullQueue from "viewer/model/bucket_data_handling/pullqueue";
import type DataLayer from "viewer/model/data_layer";
import { getTotalSaveQueueLength } from "viewer/model/reducers/save_reducer";
import type { TraceOrViewCommand } from "viewer/store";
import Store from "viewer/store";

import Deferred from "libs/async/deferred";
import { globalToLayerTransformedPosition } from "./model/accessors/dataset_layer_transformation_accessor";
import { initialize } from "./model_initialization";

// TODO: Non-reactive
export class WebKnossosModel {
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'dataLayers' has no initializer and is no... Remove this comment to see the full error message
  dataLayers: Record<string, DataLayer>;
  maximumTextureCountForLayer: number = 0;

  async fetch(
    initialMaybeCompoundType: APICompoundType | null,
    initialCommandType: TraceOrViewCommand,
    initialFetch: boolean,
    version?: number | undefined | null,
  ) {
    try {
      const initializationInformation = await initialize(
        initialMaybeCompoundType,
        initialCommandType,
        initialFetch,
        version,
      );

      if (initializationInformation) {
        // Only executed on initial fetch
        const { dataLayers, maximumTextureCountForLayer } = initializationInformation;

        if (this.dataLayers != null) {
          _.values(this.dataLayers).forEach((layer) => layer.destroy());
        }

        this.dataLayers = dataLayers;
        this.maximumTextureCountForLayer = maximumTextureCountForLayer;
      }
    } catch (error) {
      try {
        const maybeOrganizationToSwitchTo =
          await isDatasetAccessibleBySwitching(initialCommandType);

        if (maybeOrganizationToSwitchTo != null) {
          // @ts-ignore
          error.organizationToSwitchTo = maybeOrganizationToSwitchTo;
        }
      } catch (accessibleBySwitchingError) {
        console.error(
          "An error occurred while requesting a organization the user can switch to to see the dataset.",
          accessibleBySwitchingError,
        );
      }

      throw error;
    }
  }

  getAllLayers(): Array<DataLayer> {
    return Utils.values(this.dataLayers);
  }

  getColorLayers(): Array<DataLayer> {
    return _.filter(
      this.dataLayers,
      (dataLayer) => getLayerByName(Store.getState().dataset, dataLayer.name).category === "color",
    );
  }

  getSegmentationLayers(): Array<DataLayer> {
    return Utils.values(this.dataLayers).filter(
      (dataLayer) =>
        getLayerByName(Store.getState().dataset, dataLayer.name).category === "segmentation",
    );
  }

  getSegmentationTracingLayers(): Array<DataLayer> {
    return Utils.values(this.dataLayers).filter((dataLayer) => {
      const layer = getLayerByName(Store.getState().dataset, dataLayer.name);
      return layer.category === "segmentation" && layer.tracingId != null;
    });
  }

  getSomeSegmentationLayer(): DataLayer | null | undefined {
    // Prefer the visible segmentation layer. If that does not exist,
    // simply use one of the available segmentation layers.
    const visibleSegmentationLayer = this.getVisibleSegmentationLayer();
    const segmentationLayers = this.getSegmentationLayers();

    if (visibleSegmentationLayer) {
      return visibleSegmentationLayer;
    } else if (segmentationLayers.length > 0) {
      return segmentationLayers[0];
    }

    return null;
  }

  getVisibleSegmentationLayer(): DataLayer | null | undefined {
    const state = Store.getState();
    const { datasetConfiguration } = state;
    const { viewMode } = state.temporaryConfiguration;
    const segmentationLayers = this.getSegmentationLayers();
    const visibleSegmentationLayers = segmentationLayers.filter((layer) =>
      isLayerVisible(state.dataset, layer.name, datasetConfiguration, viewMode),
    );

    if (visibleSegmentationLayers.length > 0) {
      return visibleSegmentationLayers[0];
    }

    return null;
  }

  hasSegmentationLayer(): boolean {
    return this.getSegmentationLayers().length > 0;
  }

  getSegmentationTracingLayer(tracingId: string): DataLayer {
    return this.getLayerByName(tracingId);
  }

  getActiveSegmentationTracingLayer(): DataLayer | null | undefined {
    const state = Store.getState();
    const layer = getActiveSegmentationTracingLayer(state);

    if (layer == null) {
      return null;
    }

    return this.getLayerByName(layer.name);
  }

  getEnforcedSegmentationTracingLayer(): DataLayer {
    const layer = this.getActiveSegmentationTracingLayer();

    if (layer == null) {
      // The function should never be called if no segmentation layer exists.
      throw new Error("No segmentation layer found.");
    }

    return layer;
  }

  getCurrentlyRenderedZoomStepAtPosition(
    layerName: string,
    position: Vector3 | null | undefined,
  ): number {
    const state = Store.getState();
    const { additionalCoordinates } = state.flycam;

    const zoomStep = getActiveMagIndexForLayer(state, layerName);
    if (position == null) return zoomStep;
    const cube = this.getCubeByLayerName(layerName);
    // Depending on the zoom value, which magnifications are loaded and other settings,
    // the currently rendered zoom step has to be determined.
    const renderedZoomStep = cube.getNextCurrentlyUsableZoomStepForPosition(
      position,
      additionalCoordinates,
      zoomStep,
    );
    return renderedZoomStep;
  }

  async getUltimatelyRenderedZoomStepAtPosition(
    layerName: string,
    position: Vector3,
  ): Promise<number> {
    const state = Store.getState();
    const { additionalCoordinates } = state.flycam;
    const zoomStep = getActiveMagIndexForLayer(state, layerName);
    const cube = this.getCubeByLayerName(layerName);
    // Depending on the zoom value, the available magnifications and other settings,
    // the ultimately rendered zoom step has to be determined.
    const renderedZoomStep = await cube.getNextUltimatelyUsableZoomStepForPosition(
      position,
      additionalCoordinates,
      zoomStep,
    );
    return renderedZoomStep;
  }

  getHoveredCellId(globalMousePosition: Vector3 | null | undefined):
    | {
        id: number;
        isMapped: boolean;
        unmappedId: number;
      }
    | null
    | undefined {
    // Returns
    // - id (which might be mapped)
    // - isMapped (specifies whether id is mapped)
    // - unmappedId (equal to id if isMapped is false)
    const segmentationLayer = this.getVisibleSegmentationLayer();

    if (!segmentationLayer || !globalMousePosition) {
      return null;
    }

    const segmentationLayerName = segmentationLayer.name;
    const { cube } = segmentationLayer;
    const renderedZoomStepForMousePosition = this.getCurrentlyRenderedZoomStepAtPosition(
      segmentationLayerName,
      globalMousePosition,
    );

    const getIdForPos = (pos: Vector3, usableZoomStep: number) => {
      const state = Store.getState();
      const additionalCoordinates = state.flycam.additionalCoordinates;
      const posInLayerSpace = globalToLayerTransformedPosition(
        pos,
        segmentationLayer.name,
        "segmentation",
        state,
      );
      const id = cube.getDataValue(posInLayerSpace, additionalCoordinates, null, usableZoomStep);
      return {
        // Note that this id can be an unmapped id even when
        // a mapping is active, if it is a HDF5 mapping that is partially loaded
        // and no entry exists yet for the input id.
        id: cube.mapId(id),
        unmappedId: id,
      };
    };

    const { id, unmappedId } = getIdForPos(globalMousePosition, renderedZoomStepForMousePosition);
    return {
      id,
      isMapped: cube.isMappingEnabled(),
      unmappedId,
    };
  }

  getCubeByLayerName(name: string): DataCube {
    if (!this.dataLayers[name]) {
      throw new Error(`Layer with name ${name} was not found.`);
    }

    return this.dataLayers[name].cube;
  }

  getPullQueueByLayerName(name: string): PullQueue {
    return this.getLayerByName(name).pullQueue;
  }

  getLayerByName(name: string): DataLayer {
    if (!this.dataLayers[name]) {
      throw new Error(`Layer with name ${name} was not found.`);
    }

    return this.dataLayers[name];
  }

  getSegmentationLayerWithMappingSupport(): DataLayer | null | undefined {
    const layer = getSegmentationLayerWithMappingSupport(Store.getState());

    if (!layer) {
      return null;
    }

    return this.getLayerByName(layer.name);
  }

  getLayerRenderingManagerByName(name: string): LayerRenderingManager {
    if (!this.dataLayers[name]) {
      throw new Error(`Layer with name ${name} was not found.`);
    }

    return this.dataLayers[name].layerRenderingManager;
  }

  stateSaved() {
    const state = Store.getState();
    const storeStateSaved = !state.save.isBusy && getTotalSaveQueueLength(state.save.queue) === 0;

    const pushQueuesSaved = _.reduce(
      this.dataLayers,
      (saved, dataLayer) => saved && dataLayer.pushQueue.stateSaved(),
      true,
    );

    return storeStateSaved && pushQueuesSaved;
  }

  getLongestPushQueueWaitTime() {
    return (
      _.max(
        Utils.values(this.dataLayers).map((layer) => layer.pushQueue.getTransactionWaitTime()),
      ) || 0
    );
  }

  getPushQueueStats = () => {
    const compressingBucketCount = _.sum(
      Utils.values(this.dataLayers).map((dataLayer) =>
        dataLayer.pushQueue.getCompressingBucketCount(),
      ),
    );

    const waitingForCompressionBucketCount = _.sum(
      Utils.values(this.dataLayers).map((dataLayer) => dataLayer.pushQueue.getPendingBucketCount()),
    );

    const outstandingBucketDownloadCount = _.sum(
      Utils.values(this.dataLayers).map((dataLayer) =>
        dataLayer.cube.temporalBucketManager.getCount(),
      ),
    );

    return {
      compressingBucketCount,
      waitingForCompressionBucketCount,
      outstandingBucketDownloadCount,
    };
  };

  forceSave = () => {
    // In contrast to the save function, this method will trigger exactly one saveNowAction
    // regardless of what the current save state is
    // This will force a new save try, even if the save saga is currently waiting to retry the save request
    Store.dispatch(saveNowAction());
  };

  ensureSavedState = async () => {
    /* This function will only return once all state is saved
     * even if new updates are pushed to the save queue during saving
     */

    // This is a helper function which ensures that the diffing sagas
    // have seen the newest tracings. These sagas are responsible for diffing
    // old vs. new tracings to fill the save queue with update actions.
    // waitForDifferResponses dispatches a special action which the diffing sagas
    // will respond to by calling the callback that is attached to the action.
    // That way, we can be sure that the diffing sagas have processed all user actions
    // up until the time of where waitForDifferResponses was invoked.
    async function waitForDifferResponses() {
      const { annotation } = Store.getState();
      // All skeleton and volume tracings should respond to the dispatched action.
      const tracingIds = new Set(
        _.compact([annotation.skeleton?.tracingId, ...annotation.volumes.map((t) => t.tracingId)]),
      );
      const reportedTracingIds = new Set();
      const deferred = new Deferred();
      function callback(tracingId: string) {
        reportedTracingIds.add(tracingId);
        if (Utils.areSetsEqual(tracingIds, reportedTracingIds)) {
          deferred.resolve(null);
        }
      }

      Store.dispatch(ensureTracingsWereDiffedToSaveQueueAction(callback));
      await deferred.promise();
      return true;
    }

    while ((await waitForDifferResponses()) && !this.stateSaved()) {
      // The dispatch of the saveNowAction IN the while loop is deliberate.
      // Otherwise if an update action is pushed to the save queue during the Utils.sleep,
      // the while loop would continue running until the next save would be triggered.
      if (!Store.getState().save.isBusy) {
        Store.dispatch(saveNowAction());
      }

      await Utils.sleep(500);
    }
  };

  reset() {
    /*
     * Destroys all layers
     */

    if (this.dataLayers != null) {
      _.values(this.dataLayers).forEach((layer) => layer.destroy());
      this.dataLayers = {};
    }
  }
}
const model = new WebKnossosModel(); // export the model as a singleton

export type ModelType = typeof model;

export default model;
