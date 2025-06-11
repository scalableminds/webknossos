import update from "immutability-helper";
import DiffableMap from "libs/diffable_map";
import { enforceSkeletonTracing, getTree } from "viewer/model/accessors/skeletontracing_accessor";
import {
  setTreeEdgeVisibilityAction,
  setTreeGroupsAction,
} from "viewer/model/actions/skeletontracing_actions";
import EdgeCollection from "viewer/model/edge_collection";
import type { ApplicableSkeletonUpdateAction } from "viewer/model/sagas/update_actions";
import type { Tree } from "viewer/model/types/tree_types";
import type { Reducer, WebknossosState } from "viewer/store";
import { getMaximumNodeId } from "../skeletontracing_reducer_helpers";
import {
  applyAddUserBoundingBox,
  applyDeleteUserBoundingBox,
  applyUpdateUserBoundingBox,
} from "./bounding_box";

export function applySkeletonUpdateActionsFromServer(
  SkeletonTracingReducer: Reducer,
  actions: ApplicableSkeletonUpdateAction[],
  newState: WebknossosState,
): { value: WebknossosState } {
  for (const ua of actions) {
    switch (ua.name) {
      case "createTree": {
        const { id, updatedId: _updatedId, actionTracingId: _actionTracingId, ...rest } = ua.value;
        const newTree: Tree = {
          treeId: id,
          ...rest,
          nodes: new DiffableMap(),
          edges: new EdgeCollection(),
        };
        const newTrees = enforceSkeletonTracing(newState.annotation).trees.set(id, newTree);

        newState = update(newState, {
          annotation: {
            skeleton: {
              trees: {
                $set: newTrees,
              },
            },
          },
        });
        break;
      }
      case "updateTree": {
        const {
          id: treeId,
          actionTracingId: _actionTracingId,
          updatedId: _updatedId,
          ...treeRest
        } = ua.value;
        const skeleton = enforceSkeletonTracing(newState.annotation);
        const tree = getTree(skeleton, treeId);
        if (tree == null) {
          throw new Error("Could not create node because tree was not found.");
        }
        const newTree = { ...tree, ...treeRest };
        const newTrees = skeleton.trees.set(newTree.treeId, newTree);
        newState = update(newState, {
          annotation: {
            skeleton: {
              trees: {
                $set: newTrees,
              },
            },
          },
        });
        break;
      }
      case "createNode": {
        const { treeId, ...serverNode } = ua.value;
        const {
          position: untransformedPosition,
          resolution: mag,
          actionTracingId: _actionTracingId,
          ...node
        } = serverNode;
        const clientNode = { untransformedPosition, mag, ...node };

        const skeleton = enforceSkeletonTracing(newState.annotation);
        const tree = getTree(skeleton, treeId);
        if (tree == null) {
          throw new Error("Could not create node because tree was not found.");
        }
        const diffableNodeMap = tree.nodes;
        const newDiffableMap = diffableNodeMap.set(node.id, clientNode);
        const newTree = update(tree, {
          nodes: { $set: newDiffableMap },
        });
        const newTrees = skeleton.trees.set(newTree.treeId, newTree);

        newState = update(newState, {
          annotation: {
            skeleton: {
              trees: {
                $set: newTrees,
              },
              cachedMaxNodeId: { $set: getMaximumNodeId(newTrees) },
            },
          },
        });
        break;
      }
      case "updateNode": {
        const { treeId, ...serverNode } = ua.value;
        const {
          position: untransformedPosition,
          actionTracingId: _actionTracingId,
          mag,
          ...node
        } = serverNode;
        const clientNode = { untransformedPosition, mag, ...node };

        const skeleton = enforceSkeletonTracing(newState.annotation);
        const tree = getTree(skeleton, treeId);
        if (tree == null) {
          throw new Error("Could not update node because tree was not found.");
        }
        const diffableNodeMap = tree.nodes;
        const newDiffableMap = diffableNodeMap.set(node.id, clientNode);
        const newTree = update(tree, {
          nodes: { $set: newDiffableMap },
        });
        const newTrees = skeleton.trees.set(newTree.treeId, newTree);

        newState = update(newState, {
          annotation: {
            skeleton: {
              trees: {
                $set: newTrees,
              },
            },
          },
        });
        break;
      }
      case "createEdge": {
        const { treeId, source, target } = ua.value;
        // eslint-disable-next-line no-loop-func
        if (newState.annotation.skeleton == null) {
          continue;
        }

        const tree = getTree(newState.annotation.skeleton, treeId);
        if (tree == null) {
          // todop: escalate error?
          continue;
        }
        const newEdge = {
          source,
          target,
        };
        const edges = tree.edges.addEdge(newEdge);
        const newTree = update(tree, { edges: { $set: edges } });
        const newTrees = newState.annotation.skeleton.trees.set(tree.treeId, newTree);

        newState = update(newState, {
          annotation: {
            skeleton: {
              trees: {
                $set: newTrees,
              },
            },
          },
        });
        break;
      }
      case "deleteTree": {
        const { id } = ua.value;
        const skeleton = enforceSkeletonTracing(newState.annotation);
        const updatedTrees = skeleton.trees.delete(id);

        newState = update(newState, {
          annotation: {
            skeleton: {
              trees: { $set: updatedTrees },
              cachedMaxNodeId: { $set: getMaximumNodeId(updatedTrees) },
            },
          },
        });

        break;
      }
      case "moveTreeComponent": {
        // Use the _ prefix to ensure that the following code rather
        // uses the nodeIdSet.
        const { nodeIds: _nodeIds, sourceId, targetId } = ua.value;
        const nodeIdSet = new Set(_nodeIds);

        const skeleton = enforceSkeletonTracing(newState.annotation);
        const sourceTree = getTree(skeleton, sourceId);
        const targetTree = getTree(skeleton, targetId);

        if (!sourceTree || !targetTree) {
          throw new Error("Source or target tree not found.");
        }

        // Separate moved and remaining nodes
        const movedNodeEntries = sourceTree.nodes
          .entries()
          .filter(([id]) => nodeIdSet.has(id))
          .toArray();
        const remainingNodeEntries = sourceTree.nodes
          .entries()
          .filter(([id]) => !nodeIdSet.has(id))
          .toArray();

        // Separate moved and remaining edges
        const movedEdges = sourceTree.edges
          .toArray()
          .filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target));
        const remainingEdges = sourceTree.edges
          .toArray()
          .filter((e) => !(nodeIdSet.has(e.source) && nodeIdSet.has(e.target)));

        // Create updated source tree
        const updatedSourceTree = {
          ...sourceTree,
          nodes: new DiffableMap(remainingNodeEntries),
          edges: new EdgeCollection().addEdges(remainingEdges),
        };

        // Create updated target tree
        const updatedTargetNodes = targetTree.nodes.clone();
        for (const [id, node] of movedNodeEntries) {
          updatedTargetNodes.mutableSet(id, node);
        }

        const updatedTargetEdges = targetTree.edges.clone().addEdges(movedEdges, true);

        const updatedTargetTree = {
          ...targetTree,
          nodes: updatedTargetNodes,
          edges: updatedTargetEdges,
        };

        const updatedTrees = skeleton.trees
          .set(sourceId, updatedSourceTree)
          .set(targetId, updatedTargetTree);

        newState = update(newState, {
          annotation: {
            skeleton: {
              trees: { $set: updatedTrees },
            },
          },
        });

        break;
      }

      case "deleteEdge": {
        const { treeId, source, target } = ua.value;

        const skeleton = enforceSkeletonTracing(newState.annotation);
        const tree = getTree(skeleton, treeId);

        if (!tree) {
          throw new Error("Source or target tree not found.");
        }

        const updatedTree = {
          ...tree,
          edges: tree.edges.removeEdge({ source, target }),
        };

        const updatedTrees = skeleton.trees.set(treeId, updatedTree);

        newState = update(newState, {
          annotation: {
            skeleton: {
              trees: { $set: updatedTrees },
            },
          },
        });

        break;
      }

      case "deleteNode": {
        const { treeId, nodeId } = ua.value;

        const skeleton = enforceSkeletonTracing(newState.annotation);
        const tree = getTree(skeleton, treeId);

        if (!tree) {
          throw new Error("Source or target tree not found.");
        }

        const updatedTree = {
          ...tree,
          nodes: tree.nodes.delete(nodeId),
        };

        const updatedTrees = skeleton.trees.set(treeId, updatedTree);

        const newActiveNodeId = skeleton.activeNodeId === nodeId ? null : nodeId;

        newState = update(newState, {
          annotation: {
            skeleton: {
              trees: { $set: updatedTrees },
              cachedMaxNodeId: { $set: getMaximumNodeId(updatedTrees) },
              activeNodeId: { $set: newActiveNodeId },
            },
          },
        });

        break;
      }

      case "updateTreeGroups": {
        newState = SkeletonTracingReducer(newState, setTreeGroupsAction(ua.value.treeGroups));
        break;
      }

      case "updateTreeGroupsExpandedState": {
        // changes to user specific state does not need to be reacted to
        break;
      }

      case "updateTreeEdgesVisibility": {
        newState = SkeletonTracingReducer(
          newState,
          setTreeEdgeVisibilityAction(ua.value.treeId, ua.value.edgesAreVisible),
        );
        break;
      }

      case "updateUserBoundingBoxInSkeletonTracing": {
        newState = applyUpdateUserBoundingBox(
          newState,
          enforceSkeletonTracing(newState.annotation),
          ua,
        );
        break;
      }
      case "addUserBoundingBoxInSkeletonTracing": {
        newState = applyAddUserBoundingBox(
          newState,
          enforceSkeletonTracing(newState.annotation),
          ua,
        );
        break;
      }
      case "updateUserBoundingBoxVisibilityInSkeletonTracing": {
        // Visibility updates are user-specific and don't need to be
        // incorporated for the current user.
        break;
      }
      case "deleteUserBoundingBoxInSkeletonTracing": {
        newState = applyDeleteUserBoundingBox(
          newState,
          enforceSkeletonTracing(newState.annotation),
          ua,
        );
        break;
      }
      default: {
        ua satisfies never;
      }
    }
  }

  // The state is wrapped in this container object to prevent the above switch-cases from
  // accidentally returning newState (which is common in reducers but would ignore
  // remaining update actions here).
  return { value: newState };
}
