import { withoutValues } from "libs/utils";
import _ from "lodash";
import compactToggleActions from "viewer/model/helpers/compaction/compact_toggle_actions";
import type {
  CreateEdgeUpdateAction,
  CreateNodeUpdateAction,
  DeleteEdgeUpdateAction,
  DeleteNodeUpdateAction,
  DeleteTreeUpdateAction,
  UpdateActionWithoutIsolationRequirement,
} from "viewer/model/sagas/volume/update_actions";
import { moveTreeComponent, updateNode } from "viewer/model/sagas/volume/update_actions";
import type { SkeletonTracing, VolumeTracing } from "viewer/store";

// The Cantor pairing function assigns one natural number to each pair of natural numbers
function cantor(a: number, b: number): number {
  return 0.5 * (a + b) * (a + b + 1) + b;
}

function compactMovedNodesAndEdges(
  updateActions: Array<UpdateActionWithoutIsolationRequirement>,
  prevTracing: SkeletonTracing | VolumeTracing,
  tracing: SkeletonTracing | VolumeTracing,
) {
  // This function detects tree merges and splits.
  // It does so by identifying nodes and edges that were deleted in one tree only to be created
  // in another tree again afterwards.
  // It replaces the original deleteNode/createNode and deleteEdge/createEdge update actions
  // with a moveTreeComponent update action.
  // As one tree split can produce multiple new trees (if a branchpoint is deleted), the moved nodes
  // and edges have to be grouped by their old and new treeId. Then one moveTreeComponent update action
  // is inserted for each group, containing the respective moved node ids.
  // The exact spot where the moveTreeComponent update action is inserted is important. This is
  // described later.

  if (prevTracing.type !== "skeleton" || tracing.type !== "skeleton") {
    return updateActions;
  }
  let compactedActions = [...updateActions];
  // Detect moved nodes and edges
  const movedNodesAndEdges: Array<
    | [CreateNodeUpdateAction, DeleteNodeUpdateAction]
    | [CreateEdgeUpdateAction, DeleteEdgeUpdateAction]
  > = [];

  // Performance improvement: create a map of the deletedNode update actions, key is the nodeId
  const deleteNodeActionsMap = _.keyBy(updateActions, (ua) =>
    ua.name === "deleteNode" ? ua.value.nodeId : -1,
  );

  // Performance improvement: create a map of the deletedEdge update actions, key is the cantor pairing
  // of sourceId and targetId
  const deleteEdgeActionsMap = _.keyBy(updateActions, (ua) =>
    ua.name === "deleteEdge" ? cantor(ua.value.source, ua.value.target) : -1,
  );

  for (const createUA of updateActions) {
    if (createUA.name === "createNode") {
      const deleteUA = deleteNodeActionsMap[createUA.value.id];

      if (
        deleteUA != null &&
        deleteUA.name === "deleteNode" &&
        deleteUA.value.treeId !== createUA.value.treeId
      ) {
        movedNodesAndEdges.push([createUA, deleteUA]);
      }
    } else if (createUA.name === "createEdge") {
      const deleteUA = deleteEdgeActionsMap[cantor(createUA.value.source, createUA.value.target)];

      if (
        deleteUA != null &&
        deleteUA.name === "deleteEdge" &&
        deleteUA.value.treeId !== createUA.value.treeId
      ) {
        movedNodesAndEdges.push([createUA, deleteUA]);
      }
    }
  }

  // Group moved nodes and edges by their old and new treeId using the cantor pairing function
  // to create a single unique id
  const groupedMovedNodesAndEdges = _.groupBy(movedNodesAndEdges, ([createUA, deleteUA]) =>
    cantor(createUA.value.treeId, deleteUA.value.treeId),
  ) as Record<
    number,
    Array<
      | [CreateNodeUpdateAction, DeleteNodeUpdateAction]
      | [CreateEdgeUpdateAction, DeleteEdgeUpdateAction]
    >
  >;

  // Create a moveTreeComponent update action for each of the groups and insert it at the right spot
  for (const movedPairings of _.values(groupedMovedNodesAndEdges)) {
    const actionTracingId = movedPairings[0][1].value.actionTracingId;
    const oldTreeId = movedPairings[0][1].value.treeId;
    const newTreeId = movedPairings[0][0].value.treeId;
    const nodeIds = movedPairings
      .filter(
        (tuple): tuple is [CreateNodeUpdateAction, DeleteNodeUpdateAction] =>
          tuple[0].name === "createNode",
      )
      .map(([createUA]) => createUA.value.id);

    // The moveTreeComponent update action needs to be placed:
    // BEFORE the possible deleteTree update action of the oldTreeId and
    // AFTER the possible createTree update action of the newTreeId
    const deleteTreeUAIndex = compactedActions.findIndex(
      (ua) => ua.name === "deleteTree" && ua.value.id === oldTreeId,
    );
    const createTreeUAIndex = compactedActions.findIndex(
      (ua) => ua.name === "createTree" && ua.value.id === newTreeId,
    );

    const moveAction = moveTreeComponent(oldTreeId, newTreeId, nodeIds, actionTracingId);

    if (deleteTreeUAIndex > -1 && createTreeUAIndex > -1) {
      // This should not happen, but in case it does, the moveTreeComponent update action
      // cannot be inserted as the createTreeUA is after the deleteTreeUA
      // Skip the removal of the original create/delete update actions!
      continue;
    } else if (createTreeUAIndex > -1) {
      // Insert after the createTreeUA
      compactedActions.splice(createTreeUAIndex + 1, 0, moveAction);
    } else if (deleteTreeUAIndex > -1) {
      // Insert before the deleteTreeUA
      compactedActions.splice(deleteTreeUAIndex, 0, moveAction);
    } else {
      // Insert in front
      compactedActions.unshift(moveTreeComponent(oldTreeId, newTreeId, nodeIds, actionTracingId));
    }

    // Add updateNode actions if node was changed (by reference)
    for (const [createUA, deleteUA] of movedPairings) {
      if (createUA.name === "createNode" && deleteUA.name === "deleteNode") {
        const nodeId = createUA.value.id;
        const newNode = tracing.trees.getNullable(newTreeId)?.nodes.getNullable(nodeId);
        const oldNode = prevTracing.trees.getNullable(oldTreeId)?.nodes.getNullable(nodeId);

        if (newNode !== oldNode && newNode != null) {
          compactedActions.push(updateNode(newTreeId, newNode, actionTracingId));
        }
      }
    }

    // Remove the original create/delete update actions of the moved nodes and edges.
    type CreateOrDeleteNodeOrEdge =
      | CreateNodeUpdateAction
      | DeleteNodeUpdateAction
      | CreateEdgeUpdateAction
      | DeleteEdgeUpdateAction;

    compactedActions = withoutValues(
      compactedActions,
      // Cast movedPairs type to satisfy _.flatten
      _.flatten(movedPairings as Array<[CreateOrDeleteNodeOrEdge, CreateOrDeleteNodeOrEdge]>),
    );
  }

  return compactedActions;
}

function compactDeletedTrees(updateActions: Array<UpdateActionWithoutIsolationRequirement>) {
  // This function detects deleted trees.
  // Instead of sending deleteNode/deleteEdge update actions for all nodes of a deleted tree,
  // just one deleteTree update action is sufficient for the server to delete the tree.
  // As the deleteTree update action is already part of the update actions if a tree is deleted,
  // all corresponding deleteNode/deleteEdge update actions can simply be removed.
  const deletedTreeIds = updateActions
    .filter((ua) => ua.name === "deleteTree")
    .map((ua) => (ua as DeleteTreeUpdateAction).value.id);
  return _.filter(
    updateActions,
    (ua) =>
      !(
        (ua.name === "deleteNode" || ua.name === "deleteEdge") &&
        deletedTreeIds.includes(ua.value.treeId)
      ),
  );
}

export default function compactUpdateActions(
  updateActions: Array<UpdateActionWithoutIsolationRequirement>,
  prevTracing: SkeletonTracing | VolumeTracing,
  tracing: SkeletonTracing | VolumeTracing,
): Array<UpdateActionWithoutIsolationRequirement> {
  return compactToggleActions(
    compactDeletedTrees(compactMovedNodesAndEdges(updateActions, prevTracing, tracing)),
    tracing,
  );
}
