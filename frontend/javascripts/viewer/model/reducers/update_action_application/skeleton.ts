import update from "immutability-helper";
import DiffableMap from "libs/diffable_map";
import {
  enforceSkeletonTracing,
  findTreeByNodeId,
  getTree,
  getTreeGroupsMap,
} from "viewer/model/accessors/skeletontracing_accessor";
import { changeUserBoundingBoxAction } from "viewer/model/actions/annotation_actions";
import {
  setTreeEdgeVisibilityAction,
  setTreeGroupsAction,
  setTreeVisibilityAction,
} from "viewer/model/actions/skeletontracing_actions";
import EdgeCollection from "viewer/model/edge_collection";
import type { ApplicableSkeletonServerUpdateAction } from "viewer/model/sagas/volume/update_actions";
import type { Tree, TreeGroup } from "viewer/model/types/tree_types";
import type { Reducer, WebknossosState } from "viewer/store";
import { updateUserBoundingBox } from "../annotation_reducer";
import {
  getMaximumNodeId,
  setExpandedTreeGroups,
  toggleAllTreesReducer,
  toggleTreeGroupReducer,
} from "../skeletontracing_reducer_helpers";
import {
  applyAddUserBoundingBox,
  applyDeleteUserBoundingBox,
  applyUpdateUserBoundingBox,
} from "./bounding_box";
import { withoutActionTimestamp, withoutServerSpecificFields } from "./shared_update_helper";

export function applySkeletonUpdateActionsFromServer(
  SkeletonTracingReducer: Reducer,
  actions: ApplicableSkeletonServerUpdateAction[],
  state: WebknossosState,
  ignoreUnsupportedActionTypes: boolean,
): WebknossosState {
  let newState = state;
  for (const ua of actions) {
    newState = applySingleAction(
      SkeletonTracingReducer,
      ua,
      newState,
      ignoreUnsupportedActionTypes,
    );
  }

  return newState;
}

function applySingleAction(
  SkeletonTracingReducer: Reducer,
  ua: ApplicableSkeletonServerUpdateAction,
  state: WebknossosState,
  ignoreUnsupportedActionTypes: boolean,
): WebknossosState {
  switch (ua.name) {
    case "createTree": {
      // updatedId is part of the updateAction format but was never really used.
      const { id, updatedId: _updatedId, ...rest } = withoutServerSpecificFields(ua).value;
      const newTree: Tree = {
        treeId: id,
        ...rest,
        nodes: new DiffableMap(),
        edges: new EdgeCollection(),
      };
      const newTrees = enforceSkeletonTracing(state.annotation).trees.set(id, newTree);

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }
    case "updateTree": {
      const {
        id: treeId,
        // updatedId is part of the updateAction format but was never really used.
        updatedId: _updatedId,
        ...treeRest
      } = withoutServerSpecificFields(ua).value;
      const skeleton = enforceSkeletonTracing(state.annotation);
      const tree = getTree(skeleton, treeId);
      if (tree == null) {
        throw new Error("Could not create node because tree was not found.");
      }
      const newTree = { ...tree, ...treeRest };
      const newTrees = skeleton.trees.set(newTree.treeId, newTree);
      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }
    case "createNode": {
      const { treeId, ...serverNode } = withoutServerSpecificFields(ua).value;
      const { position: untransformedPosition, resolution: mag, ...node } = serverNode;
      const clientNode = { untransformedPosition, mag, ...node };

      const skeleton = enforceSkeletonTracing(state.annotation);
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

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
            cachedMaxNodeId: { $set: getMaximumNodeId(newTrees) },
          },
        },
      });
    }
    case "updateNode": {
      const { treeId, ...serverNode } = withoutServerSpecificFields(ua).value;
      const { position: untransformedPosition, mag, ...node } = serverNode;
      const clientNode = { untransformedPosition, mag, ...node };

      const skeleton = enforceSkeletonTracing(state.annotation);
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

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }
    case "deleteTree": {
      const { id } = ua.value;
      const skeleton = enforceSkeletonTracing(state.annotation);
      const updatedTrees = skeleton.trees.delete(id);

      const newActiveTreeId = skeleton.activeTreeId === id ? null : skeleton.activeTreeId;

      return update(state, {
        annotation: {
          skeleton: {
            trees: { $set: updatedTrees },
            cachedMaxNodeId: { $set: getMaximumNodeId(updatedTrees) },
            activeTreeId: { $set: newActiveTreeId },
          },
        },
      });
    }
    case "moveTreeComponent": {
      // Use the _ prefix to ensure that the following code rather
      // uses the nodeIdSet.
      const { nodeIds: _nodeIds, sourceId, targetId } = ua.value;
      const nodeIdSet = new Set(_nodeIds);

      const skeleton = enforceSkeletonTracing(state.annotation);
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

      return update(state, {
        annotation: {
          skeleton: {
            trees: { $set: updatedTrees },
          },
        },
      });
    }
    case "createEdge": {
      const { treeId, source, target } = ua.value;
      // eslint-disable-next-line no-loop-func
      if (state.annotation.skeleton == null) {
        throw new Error("Could not apply update action because no skeleton exists.");
      }

      const tree = getTree(state.annotation.skeleton, treeId);
      if (tree == null) {
        throw new Error(
          `Could not apply update action because tree with id=${treeId} was not found.`,
        );
      }
      const newEdge = {
        source,
        target,
      };
      const edges = tree.edges.addEdge(newEdge);
      const newTree = update(tree, { edges: { $set: edges } });
      const newTrees = state.annotation.skeleton.trees.set(tree.treeId, newTree);

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }
    case "deleteEdge": {
      const { treeId, source, target } = ua.value;

      const skeleton = enforceSkeletonTracing(state.annotation);
      const tree = getTree(skeleton, treeId);

      if (!tree) {
        throw new Error("Source or target tree not found.");
      }

      const updatedTree = {
        ...tree,
        edges: tree.edges.removeEdge({ source, target }),
      };

      const updatedTrees = skeleton.trees.set(treeId, updatedTree);

      return update(state, {
        annotation: {
          skeleton: {
            trees: { $set: updatedTrees },
          },
        },
      });
    }

    case "deleteNode": {
      const { treeId, nodeId } = ua.value;

      const skeleton = enforceSkeletonTracing(state.annotation);
      const tree = getTree(skeleton, treeId);

      if (!tree) {
        throw new Error("Source or target tree not found.");
      }

      const updatedTree = {
        ...tree,
        nodes: tree.nodes.delete(nodeId),
      };

      const updatedTrees = skeleton.trees.set(treeId, updatedTree);

      const newActiveNodeId = skeleton.activeNodeId === nodeId ? null : skeleton.activeNodeId;

      return update(state, {
        annotation: {
          skeleton: {
            trees: { $set: updatedTrees },
            cachedMaxNodeId: { $set: getMaximumNodeId(updatedTrees) },
            activeNodeId: { $set: newActiveNodeId },
          },
        },
      });
    }

    case "updateTreeGroups": {
      return SkeletonTracingReducer(state, setTreeGroupsAction(ua.value.treeGroups));
    }

    case "updateTreeEdgesVisibility": {
      return SkeletonTracingReducer(
        state,
        setTreeEdgeVisibilityAction(ua.value.treeId, ua.value.edgesAreVisible),
      );
    }

    case "deleteUserBoundingBoxInSkeletonTracing": {
      return applyDeleteUserBoundingBox(
        state,
        enforceSkeletonTracing(state.annotation),
        withoutActionTimestamp(ua),
      );
    }

    case "updateUserBoundingBoxInSkeletonTracing": {
      return applyUpdateUserBoundingBox(
        state,
        enforceSkeletonTracing(state.annotation),
        withoutActionTimestamp(ua),
      );
    }
    case "addUserBoundingBoxInSkeletonTracing": {
      return applyAddUserBoundingBox(
        state,
        enforceSkeletonTracing(state.annotation),
        withoutActionTimestamp(ua),
      );
    }

    // These update actions below are user specific and only need to be applied
    // if these actions originate from the current user (this happens when rebasing such actions).
    case "updateTreeGroupsExpandedState": {
      const skeletonTracing = enforceSkeletonTracing(state.annotation);
      const treeGroupsMap = getTreeGroupsMap(skeletonTracing);
      const currentlyExpandedTreeGroupIds = new Set(
        Object.values(treeGroupsMap).filter((group) => group.isExpanded),
      );
      const groupIdSet = new Set(ua.value.groupIds);
      const newlyExpandedTreeGroupIds = ua.value.areExpanded
        ? currentlyExpandedTreeGroupIds.union(groupIdSet)
        : currentlyExpandedTreeGroupIds.difference(groupIdSet);
      // changes to user specific state does not need to be reacted to
      return setExpandedTreeGroups(state, (group: TreeGroup) =>
        newlyExpandedTreeGroupIds.has(group.groupId),
      );
    }

    case "updateUserBoundingBoxVisibilityInSkeletonTracing": {
      // Visibility updates are user-specific and should only be incorporated
      // when rebasing the user's actions from the save queue.
      return updateUserBoundingBox(
        state,
        changeUserBoundingBoxAction(ua.value.boundingBoxId, {
          isVisible: ua.value.isVisible,
        }),
      );
    }

    // User specific actions
    case "updateActiveNode": {
      if (ua.value.activeNode == null) {
        return update(state, {
          annotation: {
            skeleton: {
              activeNodeId: {
                $set: null,
              },
            },
          },
        });
      }
      const tree = findTreeByNodeId(
        enforceSkeletonTracing(state.annotation).trees,
        ua.value.activeNode,
      );
      if (tree) {
        return update(state, {
          annotation: {
            skeleton: {
              activeNodeId: {
                $set: ua.value.activeNode,
              },
              activeTreeId: {
                $set: tree.treeId,
              },
            },
          },
        });
      }
      return state;
    }
    case "updateActiveTree": {
      const skeletonTracing = enforceSkeletonTracing(state.annotation);
      if (ua.value.activeTree) {
        const tree = getTree(skeletonTracing, ua.value.activeTree);
        if (!tree) {
          return state;
        }
      }
      return update(state, {
        annotation: {
          skeleton: {
            activeTreeId: {
              $set: ua.value.activeTree,
            },
            activeNodeId: {
              $set: ua.value.activeNode,
            },
          },
        },
      });
    }
    case "updateTreeVisibility": {
      return SkeletonTracingReducer(
        state,
        setTreeVisibilityAction(ua.value.treeId, ua.value.isVisible),
      );
    }
    case "updateTreeGroupVisibility": {
      if (ua.value.treeGroupId != null) {
        return toggleTreeGroupReducer(
          state,
          enforceSkeletonTracing(state.annotation),
          ua.value.treeGroupId,
          ua.value.isVisible,
        );
      } else {
        return toggleAllTreesReducer(
          state,
          enforceSkeletonTracing(state.annotation),
          ua.value.isVisible,
        );
      }
    }
    default: {
      ua satisfies never;
    }
  }
  ua satisfies never;

  if (ignoreUnsupportedActionTypes) {
    return state;
  }
  // Satisfy TS.
  throw new Error("Reached unexpected part of function.");
}
