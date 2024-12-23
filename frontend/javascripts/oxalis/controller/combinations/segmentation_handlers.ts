import type { Point2, Vector3 } from "oxalis/constants";
import { Model } from "oxalis/singletons";
import { calculateGlobalPos } from "oxalis/model/accessors/view_mode_accessor";
import { getMappingInfo } from "oxalis/model/accessors/dataset_accessor";
import { loadAgglomerateSkeletonAction } from "oxalis/model/actions/skeletontracing_actions";
import Store from "oxalis/store";
import Toast from "libs/toast";
import { clickSegmentAction } from "oxalis/model/actions/volumetracing_actions";
import {
  getSegmentIdForPosition,
  getSegmentIdForPositionAsync,
} from "oxalis/controller/combinations/volume_handlers";
import { setActiveConnectomeAgglomerateIdsAction } from "oxalis/model/actions/connectome_actions";
import { getTreeNameForAgglomerateSkeleton } from "oxalis/model/accessors/skeletontracing_accessor";
import {
  hasAgglomerateMapping,
  hasConnectomeFile,
} from "oxalis/model/accessors/volumetracing_accessor";

export async function handleAgglomerateSkeletonAtClick(clickPosition: Point2) {
  const state = Store.getState();
  const globalPosition = calculateGlobalPos(state, clickPosition);
  loadAgglomerateSkeletonAtPosition(globalPosition);
}
export async function loadAgglomerateSkeletonAtPosition(position: Vector3): Promise<string | null> {
  const segmentation = Model.getVisibleSegmentationLayer();

  if (!segmentation) {
    return null;
  }

  const segmentId = await getSegmentIdForPositionAsync(position);
  return loadAgglomerateSkeletonForSegmentId(segmentId);
}
export function loadAgglomerateSkeletonForSegmentId(segmentId: number): string | null {
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
    Store.dispatch(loadAgglomerateSkeletonAction(segmentation.name, mappingName, segmentId));
    return getTreeNameForAgglomerateSkeleton(segmentId, mappingName);
  } else {
    Toast.error(isAgglomerateMappingEnabled.reason);
  }
  return null;
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
  const segmentId = getSegmentIdForPosition(globalPosition);
  const { additionalCoordinates } = state.flycam;

  if (segmentId > 0) {
    Store.dispatch(clickSegmentAction(segmentId, globalPosition, additionalCoordinates));
  }
}
