import type { Point2, Vector3 } from "oxalis/constants";
import { MappingStatusEnum } from "oxalis/constants";
import { Model } from "oxalis/singletons";
import { calculateGlobalPos } from "oxalis/model/accessors/view_mode_accessor";
import {
  getMappingInfo,
  getVisibleOrLastSegmentationLayer,
} from "oxalis/model/accessors/dataset_accessor";
import { loadAgglomerateSkeletonAction } from "oxalis/model/actions/skeletontracing_actions";
import type { OxalisState } from "oxalis/store";
import Store from "oxalis/store";
import Toast from "libs/toast";
import messages from "messages";
import { clickSegmentAction } from "oxalis/model/actions/volumetracing_actions";
import {
  getSegmentIdForPosition,
  getSegmentIdForPositionAsync,
} from "oxalis/controller/combinations/volume_handlers";
import { setActiveConnectomeAgglomerateIdsAction } from "oxalis/model/actions/connectome_actions";
import { getTreeNameForAgglomerateSkeleton } from "oxalis/model/accessors/skeletontracing_accessor";
export function hasAgglomerateMapping(state: OxalisState) {
  const segmentation = Model.getVisibleSegmentationLayer();

  if (!segmentation) {
    return {
      value: false,
      reason: "A segmentation layer needs to be visible to load an agglomerate skeleton.",
    };
  }

  const { mappingName, mappingType, mappingStatus } = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    segmentation.name,
  );

  if (mappingName == null || mappingStatus !== MappingStatusEnum.ENABLED) {
    return {
      value: false,
      reason: messages["tracing.agglomerate_skeleton.no_mapping"],
    };
  }

  if (mappingType !== "HDF5") {
    return {
      value: false,
      reason: messages["tracing.agglomerate_skeleton.no_agglomerate_file"],
    };
  }

  return {
    value: true,
    reason: "",
  };
}
export function hasConnectomeFile(state: OxalisState) {
  const segmentationLayer = getVisibleOrLastSegmentationLayer(state);

  if (segmentationLayer == null) {
    return {
      value: false,
      reason: "A segmentation layer needs to be visible to load the synapses of a segment.",
    };
  }

  const { currentConnectomeFile } =
    state.localSegmentationData[segmentationLayer.name].connectomeData;

  if (currentConnectomeFile == null) {
    return {
      value: false,
      reason: "A connectome file needs to be available to load the synapses of a segment.",
    };
  }

  return {
    value: true,
    reason: "",
  };
}
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
    const cellId = await getSegmentIdForPositionAsync(position);
    Store.dispatch(setActiveConnectomeAgglomerateIdsAction(segmentation.name, [cellId]));
  } else {
    Toast.error(isConnectomeEnabled.reason);
  }
}
export function handleClickSegment(clickPosition: Point2) {
  const state = Store.getState();
  const globalPosition = calculateGlobalPos(state, clickPosition);
  const cellId = getSegmentIdForPosition(globalPosition);

  if (cellId > 0) {
    Store.dispatch(clickSegmentAction(cellId, globalPosition));
  }
}
