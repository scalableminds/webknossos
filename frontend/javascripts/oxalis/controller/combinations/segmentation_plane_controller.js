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

function viewLeftClick(pos: Point2, plane: OrthoView, event: MouseEvent) {
  if (!event.shiftKey) {
    return;
  }

  if (event.ctrlKey) {
    agglomerateSkeletonLeftClick(pos);
  } else {
    isosurfaceLeftClick(pos);
  }
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
    const { mappingName, mappingType } = state.temporaryConfiguration.activeMapping;

    if (mappingName == null) {
      Toast.error(messages["tracing.agglomerate_skeleton.no_mapping"]);
      return;
    }

    if (mappingType !== "HDF5") {
      Toast.error(messages["tracing.agglomerate_skeleton.no_agglomerate_file"]);
      return;
    }

    const { dataset } = state;

    const progressCallback = createProgressCallback({ pauseDelay: 100, successMessageDelay: 5000 });
    await progressCallback(
      false,
      `Loading skeleton for agglomerate ${cellId} with mapping ${mappingName}`,
    );

    const result = await getAgglomerateSkeleton(
      dataset.dataStore.url,
      dataset,
      layerName,
      mappingName,
      cellId,
    );

    const nmlProtoBuffer = result;
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

    await progressCallback(true, "Skeleton generation done.");
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
