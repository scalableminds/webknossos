import Toast from "libs/toast";
import { getAdaptToTypeFunction } from "libs/utils";
import { put, all } from "typed-redux-saga";
import { TreeTypeEnum, type Vector3 } from "viewer/constants";
import {
  getTreeNameForAgglomerateSkeleton,
  findTreeByName,
  getTreesWithType,
  enforceSkeletonTracing,
  untransformNodePosition,
} from "viewer/model/accessors/skeletontracing_accessor";
import {
  deleteTreeAction,
  addTreesAndGroupsAction,
} from "viewer/model/actions/skeletontracing_actions";
import { createMutableTreeMapFromTreeArray } from "viewer/model/reducers/skeletontracing_reducer_helpers";
import type { Tree, TreeMap } from "viewer/model/types/tree_types";
import type { NumberLikeMap, SkeletonTracing } from "viewer/store";
import { call, type Saga, select } from "../../effect-generators";
import { diffSkeletonTracing, getAgglomerateSkeletonTracing } from "../../skeletontracing_saga";

type ActionSegmentInfo = {
  agglomerateId: number;
  unmappedId: number;
  position: Vector3;
};

function* removeAgglomerateTreeIfExists(
  agglomerateId: number,
  mappingName: string,
  trees: TreeMap,
): Saga<{ didTreeExist: boolean }> {
  const agglomerateTreeName = getTreeNameForAgglomerateSkeleton(agglomerateId, mappingName);

  const maybeAgglomerateTree = findTreeByName(trees, agglomerateTreeName);
  const suppressNextNodeActivation = true;
  if (maybeAgglomerateTree) {
    yield* put(deleteTreeAction(maybeAgglomerateTree.treeId, suppressNextNodeActivation));
    return { didTreeExist: true };
  }
  return { didTreeExist: false };
}

function* loadAgglomerateSkeleton(
  agglomerateId: number,
  tracingId: string,
  mappingName: string,
): Saga<void> {
  try {
    const agglomerateSkeleton = yield* call(
      getAgglomerateSkeletonTracing,
      tracingId,
      mappingName,
      agglomerateId,
    );
    let usedTreeIds = [];
    yield* put(
      addTreesAndGroupsAction(
        createMutableTreeMapFromTreeArray(agglomerateSkeleton.trees),
        agglomerateSkeleton.treeGroups,
        (newTreeIds) => {
          usedTreeIds = newTreeIds;
        },
      ),
    );
    if (usedTreeIds.length !== 1) {
      const annotationVersion = yield* select((state) => state.annotation.version);
      throw new Error(
        `Unexpected number of trees for agglomerate with id ${agglomerateId} in annotation version ${annotationVersion}.`,
      );
    }
  } catch (error) {
    console.warn(error);
    Toast.warning(
      `Failed to update agglomerate skeleton for agglomerate with id ${agglomerateId}. The skeleton might be out of sync with the mapping. Proofreading actions via this skeleton might not yield the desired results.`,
    );
  }
}

// This function creates an object mapping from a position (stringified) to a node id.
// The goal is to be able to remap the node ids of the refreshed agglomerate skeleton to keep
// the changes made to the skeleton minimal. Therefore, the active node id stays the same.
// Resulting in not deactivating different nodes when syncing agglomerate skeletons with a non-skeleton based proofreading action.
type PositionToIdMap = Record<string, number>;
function createPositionToIdMap(trees: Tree[]) {
  const positionToIdMap: Record<string, number> = {};
  for (const tree of trees) {
    for (const node of tree.nodes.values()) {
      positionToIdMap[node.untransformedPosition.toString()] = node.id;
    }
  }
  return positionToIdMap;
}

// TODOM: write tests for this as this can be pretty complex.
function remapNodeIdsWithPositionMap(trees: Tree[], positionToIdMap: PositionToIdMap) {
  return trees.map((tree) => {
    let updatedNodes = tree.nodes;
    let updatedEdges = tree.edges;
    for (const node of tree.nodes.values()) {
      const idFromMap = positionToIdMap[node.untransformedPosition.toString()];
      if (idFromMap != null && node.id !== idFromMap) {
        const updatedNode = {
          ...node,
          id: idFromMap,
        };
        updatedNodes = updatedNodes.set(idFromMap, updatedNode);
        updatedNodes = updatedNodes.delete(node.id);
        const involvedEdges = updatedEdges.getOutgoingEdgesForNode(node.id);
        for (const edge of involvedEdges) {
          updatedEdges = updatedEdges.removeEdge(edge);
        }
        const edgesWithUpdatedId = involvedEdges.map((edge) => ({
          source: idFromMap,
          target: edge.target,
        }));
        updatedEdges = updatedEdges.addEdges(edgesWithUpdatedId);
      }
    }
    return {
      ...tree,
      nodes: updatedNodes,
      edges: updatedEdges,
    };
  });
}

function deepDiffSkeletonTracings(
  prevSkeleton: SkeletonTracing,
  newSkeletonWithUpdatedIds: SkeletonTracing,
) {
  const newSkeletonWithCorrectProps = {
    ...prevSkeleton,
    trees: newSkeletonWithUpdatedIds.trees,
  };
  diffSkeletonTracing(prevSkeleton, newSkeletonWithCorrectProps); // TODO: make deep comparison
}

export function* syncAgglomerateSkeletonsAfterMergeAction(
  tracingId: string,
  sourceInfo: ActionSegmentInfo,
  targetInfo: ActionSegmentInfo,
): Saga<void> {
  const activeMapping = yield* select(
    (store) => store.temporaryConfiguration.activeMappingByLayer[tracingId],
  );
  const { mappingName } = activeMapping;
  const trees = yield* select((state) =>
    getTreesWithType(enforceSkeletonTracing(state.annotation), TreeTypeEnum.AGGLOMERATE),
  );
  if (mappingName == null) {
    return;
  }
  const oldSourceAgglomerateId = sourceInfo.agglomerateId;
  const oldTargetAgglomerateId = targetInfo.agglomerateId;
  // TODO: get feedback: The current code replaces the tree instead of changing it -> This might change the active node id.
  // As this is saga is executed in a not live collab scenario, this might be ok as the user did this action here anyway without keeping the skeleton updated.
  const { didTreeExist: didSourceTreeExist } = yield* call(
    removeAgglomerateTreeIfExists,
    oldSourceAgglomerateId,
    mappingName,
    trees,
  );
  const { didTreeExist: didTargetTreeExist } = yield* call(
    removeAgglomerateTreeIfExists,
    oldTargetAgglomerateId,
    mappingName,
    trees,
  );
  if (!didSourceTreeExist && !didTargetTreeExist) {
    // Do not load the merged agglomerate skeleton in case no tree existed before.
    return;
  }
  const adaptToType = getAdaptToTypeFunction(activeMapping.mapping);
  const updatedSourceAgglomerateId = Number(
    (activeMapping.mapping as NumberLikeMap | undefined)?.get(adaptToType(sourceInfo.unmappedId)) ??
      oldSourceAgglomerateId,
  );
  yield* call(loadAgglomerateSkeleton, updatedSourceAgglomerateId, tracingId, mappingName);
}

export function* syncAgglomerateSkeletonsAfterSplitAction(
  oldAgglomerateIds: number[],
  newAgglomerateIds: number[],
  tracingId: string,
  mappingName: string,
): Saga<void> {
  const trees = yield* select((state) =>
    getTreesWithType(enforceSkeletonTracing(state.annotation), TreeTypeEnum.AGGLOMERATE),
  );
  if (mappingName == null) {
    return;
  }
  // TODO: get feedback: The current code replaces the tree instead of changing it -> This might change the active node id.
  // As this is saga is executed in a not live collab scenario, this might be ok as the user did this action here anyway without keeping the skeleton updated.
  let foundAtLeastOneAgglomerateSkeleton = false;
  for (const agglomerateId of oldAgglomerateIds) {
    const { didTreeExist } = yield* call(
      removeAgglomerateTreeIfExists,
      agglomerateId,
      mappingName,
      trees,
    );
    foundAtLeastOneAgglomerateSkeleton = foundAtLeastOneAgglomerateSkeleton || didTreeExist;
  }
  if (!foundAtLeastOneAgglomerateSkeleton) {
    // Do not load the splitted agglomerate skeletons in case no tree existed before.
    return;
  }
  const loadAgglomerateSkeletonEffects = newAgglomerateIds.map((aggloId) =>
    call(loadAgglomerateSkeleton, aggloId, tracingId, mappingName),
  );
  // Run in parallel as backend requests are involved; improves speed.
  yield* all(loadAgglomerateSkeletonEffects);
}
