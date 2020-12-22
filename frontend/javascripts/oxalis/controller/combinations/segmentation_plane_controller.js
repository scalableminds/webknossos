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
import createProgressCallback from "libs/progress_callback";
import Store from "oxalis/store";
import Toast from "libs/toast";
import messages from "messages";

function segmentationLeftClick(pos: Point2, plane: OrthoView, event: MouseEvent) {
  if (!event.shiftKey) {
    return;
  }

  if (event.ctrlKey) {
    agglomerateSkeletonLeftClick(pos);
  } else {
    isosurfaceLeftClick(pos);
  }
}

export async function agglomerateSkeletonLeftClick(pos: Point2) {
  const segmentation = Model.getSegmentationLayer();
  if (!segmentation) {
    return;
  }
  const state = Store.getState();

  const layerName =
    segmentation.fallbackLayer != null ? segmentation.fallbackLayer : segmentation.name;

  const { mappingName, mappingType } = state.temporaryConfiguration.activeMapping;
  if (mappingName == null) {
    Toast.error(messages["tracing.agglomerate_skeleton.no_mapping"]);
    return;
  }
  if (mappingType !== "HDF5") {
    Toast.error(messages["tracing.agglomerate_skeleton.no_agglomerate_file"]);
    return;
  }

  const { renderMissingDataBlack } = state.datasetConfiguration;
  const zoomStep = getRequestLogZoomStep(state);
  const position = calculateGlobalPos(pos);

  // While render missing data black is not active and there is no segmentation for the current zoom step,
  // the segmentation of a higher zoom step is shown. Here we determine the next zoom step of the
  // displayed segmentation data to get the correct segment ids of the cell that was clicked on.
  const usableZoomStep = renderMissingDataBlack
    ? zoomStep
    : segmentation.cube.getNextUsableZoomStepForPosition(position, zoomStep);

  const cellId = segmentation.cube.getMappedDataValue(position, usableZoomStep);
  if (cellId === 0) {
    Toast.error(messages["tracing.agglomerate_skeleton.no_cell"]);
    return;
  }

  const { dataset } = state;

  const progressCallback = createProgressCallback({ pauseDelay: 100, successMessageDelay: 2000 });
  const { hideFn } = await progressCallback(
    false,
    `Loading skeleton for agglomerate ${cellId} with mapping ${mappingName}`,
  );

  try {
    const nmlProtoBuffer = await getAgglomerateSkeleton(
      dataset.dataStore.url,
      dataset,
      layerName,
      mappingName,
      cellId,
    );
    const parsedTracing = parseProtoTracing(nmlProtoBuffer, "skeleton");

    if (!parsedTracing.trees) {
      // This check is only for flow to realize that we have a skeleton tracing
      // on our hands.
      throw new Error("Skeleton tracing doesn't contain trees");
    }

    Store.dispatch(
      addTreesAndGroupsAction(
        createMutableTreeMapFromTreeArray(parsedTracing.trees),
        parsedTracing.treeGroups,
      ),
    );
  } catch (e) {
    console.error(e);
    hideFn();
    return;
  }

  await progressCallback(true, "Skeleton generation done.");
}

export function isosurfaceLeftClick(pos: Point2) {
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

export default segmentationLeftClick;
