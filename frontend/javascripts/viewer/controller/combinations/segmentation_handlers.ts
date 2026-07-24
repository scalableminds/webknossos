import Toast from "libs/toast";
import type { Point2, Vector3 } from "viewer/constants";
import {
  getSegmentIdForPosition,
  getSegmentIdForPositionAsync,
} from "viewer/controller/combinations/volume_handlers";
import { hasConnectomeFile } from "viewer/model/accessors/connectome_accessor";
import {
  getMappingInfo,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import { globalToLayerTransformedPosition } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { calculateGlobalPos } from "viewer/model/accessors/view_mode_accessor";
import { hasAgglomerateMapping } from "viewer/model/accessors/volumetracing_accessor";
import { setActiveConnectomeAgglomerateIdsAction } from "viewer/model/actions/connectome_actions";
import {
  loadAgglomerateTreeAtPositionAction,
  loadAgglomerateTreeFromIdAction,
} from "viewer/model/actions/skeletontracing_actions";
import { clickSegmentAction } from "viewer/model/actions/volumetracing_actions";
import { Model } from "viewer/singletons";
import Store from "viewer/store";

export async function handleAgglomerateTreeAtClick(clickPosition: Point2) {
  const state = Store.getState();
  const globalPosition = calculateGlobalPos(state, clickPosition);
  loadAgglomerateTreeAtPosition(globalPosition.rounded);
}

function getAgglomerateTreeLoadingInfo(): [string, string] | null {
  const state = Store.getState();
  const segmentation = Model.getVisibleSegmentationLayer();

  if (!segmentation) {
    return null;
  }

  const { mappingName } = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    segmentation.name,
  );
  const isAgglomerateMappingEnabled = hasAgglomerateMapping(state);

  if (mappingName && isAgglomerateMappingEnabled.value) {
    return [segmentation.name, mappingName];
  }
  Toast.error(isAgglomerateMappingEnabled.reason);
  return null;
}

export function loadAgglomerateTreeAtPosition(position: Vector3): void {
  const agglomerateTreeLoadingInfo = getAgglomerateTreeLoadingInfo();

  if (agglomerateTreeLoadingInfo) {
    const [layerName, mappingName] = agglomerateTreeLoadingInfo;
    Store.dispatch(loadAgglomerateTreeAtPositionAction(layerName, mappingName, position));
  }
}

// loadAgglomerateTreeAtPosition should be preferred as it allows to use the up-to-date agglomerate id at the given position.
// Is needed in live-collab scenario.
export function loadAgglomerateTreeFromId(agglomerateId: bigint): void {
  const agglomerateTreeLoadingInfo = getAgglomerateTreeLoadingInfo();

  if (agglomerateTreeLoadingInfo) {
    const [layerName, mappingName] = agglomerateTreeLoadingInfo;
    Store.dispatch(loadAgglomerateTreeFromIdAction(layerName, mappingName, agglomerateId));
  }
}

export async function loadSynapsesOfAgglomerateAtPosition(position: Vector3) {
  const state = Store.getState();
  const segmentation = Model.getVisibleSegmentationLayer();

  if (!segmentation) {
    return;
  }

  const { mappingName } = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    segmentation.name,
  );
  const isConnectomeEnabled = hasConnectomeFile(state);

  if (mappingName && isConnectomeEnabled.value) {
    const segmentId = await getSegmentIdForPositionAsync(position);
    Store.dispatch(setActiveConnectomeAgglomerateIdsAction(segmentation.name, [segmentId]));
  } else {
    Toast.error(isConnectomeEnabled.reason);
  }
}
export function handleClickSegment(clickPosition: Point2) {
  const state = Store.getState();
  const globalPosition = calculateGlobalPos(state, clickPosition);
  const segmentId = getSegmentIdForPosition(globalPosition.rounded);
  const visibleSegmentationLayer = getVisibleSegmentationLayer(state);
  const positionInSegmentationLayerSpace =
    visibleSegmentationLayer != null
      ? (globalToLayerTransformedPosition(
          globalPosition.rounded,
          visibleSegmentationLayer.name,
          "segmentation",
          state,
        ).map(Math.floor) as Vector3)
      : null;

  const { additionalCoordinates } = state.flycam;

  if (segmentId !== 0n && positionInSegmentationLayerSpace != null) {
    Store.dispatch(
      clickSegmentAction(segmentId, positionInSegmentationLayerSpace, additionalCoordinates),
    );
  }
}
