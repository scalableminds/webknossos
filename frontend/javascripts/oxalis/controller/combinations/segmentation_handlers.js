// @flow
import { type Point2, type Vector3, MappingStatusEnum } from "oxalis/constants";
import Model from "oxalis/model";
import { calculateGlobalPos } from "oxalis/model/accessors/view_mode_accessor";
import { getMappingInfo } from "oxalis/model/accessors/dataset_accessor";
import { loadAgglomerateSkeletonAction } from "oxalis/model/actions/skeletontracing_actions";
import Store from "oxalis/store";
import Toast from "libs/toast";
import messages from "messages";
import { clickSegmentAction } from "oxalis/model/actions/volumetracing_actions";
import api from "oxalis/api/internal_api";
import { getSegmentIdForPosition } from "oxalis/controller/combinations/volume_handlers";

export async function handleAgglomerateSkeletonAtClick(clickPosition: Point2) {
  const state = Store.getState();
  const globalPosition = calculateGlobalPos(state, clickPosition);
  loadAgglomerateSkeletonAtPosition(globalPosition);
}

export async function loadAgglomerateSkeletonAtPosition(position: Vector3) {
  const segmentation = Model.getVisibleSegmentationLayer();
  if (!segmentation) {
    return;
  }

  const state = Store.getState();

  const { mappingName, mappingType, mappingStatus } = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    segmentation.name,
  );
  if (mappingName == null || mappingStatus !== MappingStatusEnum.ENABLED) {
    Toast.error(messages["tracing.agglomerate_skeleton.no_mapping"]);
    return;
  }
  if (mappingType !== "HDF5") {
    Toast.error(messages["tracing.agglomerate_skeleton.no_agglomerate_file"]);
    return;
  }

  const renderedZoomStep = api.data.getRenderedZoomStepAtPosition(segmentation.name, position);

  const cellId = segmentation.cube.getMappedDataValue(position, renderedZoomStep);

  Store.dispatch(loadAgglomerateSkeletonAction(segmentation.name, mappingName, cellId));
}

export function handleClickSegment(clickPosition: Point2) {
  const state = Store.getState();
  const globalPosition = calculateGlobalPos(state, clickPosition);
  const cellId = getSegmentIdForPosition(globalPosition);
  if (cellId > 0) {
    Store.dispatch(clickSegmentAction(cellId, globalPosition));
  }
}
