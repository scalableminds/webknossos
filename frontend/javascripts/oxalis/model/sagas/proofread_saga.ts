import type { Saga } from "oxalis/model/sagas/effect-generators";
import { takeEvery, put } from "typed-redux-saga";
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
import { splitAgglomerate, mergeAgglomerates } from "oxalis/model/sagas/update_actions";

export default function* proofreadMapping(): Saga<any> {
  yield* take("INITIALIZE_SKELETONTRACING");
  yield* take("WK_READY");
  yield* takeEvery(["DELETE_EDGE", "MERGE_TREES"], splitOrMergeAgglomerates);
}

function* splitOrMergeAgglomerates(action: MergeTreesAction | DeleteEdgeAction) {
  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const activeTool = yield* select((state) => state.uiInformation.activeTool);
  if (activeTool !== AnnotationToolEnum.PROOFREAD) return;

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

  const items = [];
  if (action.type === "MERGE_TREES") {
    if (sourceTree === targetTree) {
      Toast.error("Segments that should be merged need to be in different agglomerates.");
      return;
    }
    items.push(mergeAgglomerates(sourceNodePosition, targetNodePosition));
  } else if (action.type === "DELETE_EDGE") {
    if (sourceTree !== targetTree) {
      Toast.error("Segments that should be split need to be in the same agglomerate.");
      return;
    }
    items.push(splitAgglomerate(sourceNodePosition, targetNodePosition));
  }

  if (items.length) {
    yield* put(pushSaveQueueTransaction(items, tracingType, tracingId));
  }
}
