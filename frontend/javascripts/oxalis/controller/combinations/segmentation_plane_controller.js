// @flow
import { type OrthoView, type Point2 } from "oxalis/constants";
import Model from "oxalis/model";
import { changeActiveIsosurfaceCellAction } from "oxalis/model/actions/segmentation_actions";
import { calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { getAgglomerateSkeleton } from "admin/admin_rest_api";
import { parseProtoTracing } from "oxalis/model/helpers/proto_helpers";
import { createMutableTreeMapFromTreeArray } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import { addTreesAndGroupsAction } from "oxalis/model/actions/skeletontracing_actions";
import Store from "oxalis/store";

function viewLeftClick(pos: Point2, plane: OrthoView, event: MouseEvent) {
  if (!event.shiftKey) {
    return;
  }

  if (event.ctrlKey) {
    agglomerateSkeletonLeftClick(pos);
  }

  isosurfaceLeftClick(pos);
}

async function agglomerateSkeletonLeftClick(pos: Point2) {
  const position = calculateGlobalPos(pos);

  const segmentation = Model.getSegmentationLayer();
  if (!segmentation) {
    return;
  }
  const state = Store.getState();
  const cellId = segmentation.cube.getMappedDataValue(position, getRequestLogZoomStep(state));
  if (cellId > 0) {
    const layerName = segmentation.name;
    const mappingId = state.temporaryConfiguration.activeMapping.mappingName;
    const { dataset } = state;
    const result = await getAgglomerateSkeleton(
      dataset.dataStore.url,
      dataset,
      layerName,
      mappingId,
      cellId,
    );

    const nmlProtoBuffer = result;
    const parsedTracing = parseProtoTracing(nmlProtoBuffer, "skeleton");
    Store.dispatch(
      addTreesAndGroupsAction(
        createMutableTreeMapFromTreeArray(parsedTracing.trees),
        parsedTracing.treeGroups,
      ),
    );
  }
}

function isosurfaceLeftClick(pos: Point2) {
  let cellId = 0;
  const position = calculateGlobalPos(pos);
  const volumeTracingMaybe = Store.getState().tracing.volume;
  if (volumeTracingMaybe) {
    cellId = volumeTracingMaybe.activeCellId;
  } else {
    const segmentation = Model.getSegmentationLayer();
    if (!segmentation) {
      return;
    }
    cellId = segmentation.cube.getMappedDataValue(
      position,
      getRequestLogZoomStep(Store.getState()),
    );
  }
  if (cellId > 0) {
    Store.dispatch(changeActiveIsosurfaceCellAction(cellId, position));
  }
}

export default viewLeftClick;
