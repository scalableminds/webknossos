import type { Saga } from "oxalis/model/sagas/effect-generators";
import { takeEvery, put, call } from "typed-redux-saga";
import { select, take } from "oxalis/model/sagas/effect-generators";
import { AnnotationToolEnum } from "oxalis/constants";
import Toast from "libs/toast";
import type {
  DeleteEdgeAction,
  MergeTreesAction,
} from "oxalis/model/actions/skeletontracing_actions";
import {
  enforceSkeletonTracing,
  findTreeByNodeId,
} from "oxalis/model/accessors/skeletontracing_accessor";
import { pushSaveQueueTransaction } from "oxalis/model/actions/save_actions";
import { splitAgglomerate, mergeAgglomerate } from "oxalis/model/sagas/update_actions";
import Model from "oxalis/model";
import api from "oxalis/api/internal_api";
import { getActiveSegmentationTracingLayer } from "oxalis/model/accessors/volumetracing_accessor";
import { getResolutionInfo } from "oxalis/model/accessors/dataset_accessor";

export default function* proofreadMapping(): Saga<any> {
  yield* take("INITIALIZE_SKELETONTRACING");
  yield* take("WK_READY");
  yield* takeEvery(["DELETE_EDGE", "MERGE_TREES"], splitOrMergeAgglomerate);
}

function* splitOrMergeAgglomerate(action: MergeTreesAction | DeleteEdgeAction) {
  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const activeTool = yield* select((state) => state.uiInformation.activeTool);
  if (activeTool !== AnnotationToolEnum.PROOFREAD) return;

  const volumeTracingLayer = yield* select((state) => getActiveSegmentationTracingLayer(state));
  if (volumeTracingLayer == null) return;

  const layerName = volumeTracingLayer.name;
  const resolutionInfo = getResolutionInfo(volumeTracingLayer.resolutions);
  // The mag the agglomerate skeleton corresponds to should be the finest available mag of the volume tracing layer
  const agglomerateFileMag = resolutionInfo.getHighestResolution();
  const agglomerateFileZoomstep = resolutionInfo.getHighestResolutionPowerOf2();
  const { sourceNodeId, targetNodeId } = action;

  const skeletonTracing = yield* select((state) => enforceSkeletonTracing(state.tracing));

  const { trees, tracingId, type: tracingType } = skeletonTracing;
  const sourceTree = findTreeByNodeId(trees, sourceNodeId).getOrElse(null);
  const targetTree = findTreeByNodeId(trees, targetNodeId).getOrElse(null);

  if (sourceTree == null || targetTree == null) {
    return;
  }

  const sourceNodePosition = sourceTree.nodes.get(sourceNodeId).position;
  const targetNodePosition = targetTree.nodes.get(targetNodeId).position;
  const sourceNodeAgglomerateId = yield* call(
    [api.data, api.data.getDataValue],
    layerName,
    sourceNodePosition,
    agglomerateFileZoomstep,
  );
  const targetNodeAgglomerateId = yield* call(
    [api.data, api.data.getDataValue],
    layerName,
    targetNodePosition,
    agglomerateFileZoomstep,
  );

  const items = [];
  if (action.type === "MERGE_TREES") {
    if (sourceTree === targetTree || sourceNodeAgglomerateId === targetNodeAgglomerateId) {
      Toast.error("Segments that should be merged need to be in different agglomerates.");
      return;
    }
    items.push(
      mergeAgglomerate(
        sourceNodeAgglomerateId,
        targetNodeAgglomerateId,
        sourceNodePosition,
        targetNodePosition,
        agglomerateFileMag,
      ),
    );
  } else if (action.type === "DELETE_EDGE") {
    if (sourceTree !== targetTree || sourceNodeAgglomerateId !== targetNodeAgglomerateId) {
      Toast.error("Segments that should be split need to be in the same agglomerate.");
      return;
    }
    items.push(
      splitAgglomerate(
        sourceNodeAgglomerateId,
        sourceNodePosition,
        targetNodePosition,
        agglomerateFileMag,
      ),
    );
  }

  if (items.length === 0) return;

  // TODO: Will there be a separate end point for these update actions?
  yield* put(pushSaveQueueTransaction(items, tracingType, tracingId));
  yield* call([Model, Model.ensureSavedState]);

  yield* call([api.data, api.data.reloadBuckets], layerName);
}
