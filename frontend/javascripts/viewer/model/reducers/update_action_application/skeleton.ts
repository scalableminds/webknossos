import update from "immutability-helper";
import DiffableMap from "libs/diffable_map";
import { enforceSkeletonTracing, getTree } from "viewer/model/accessors/skeletontracing_accessor";
import EdgeCollection from "viewer/model/edge_collection";
import type { ApplicableSkeletonUpdateAction } from "viewer/model/sagas/update_actions";
import type { Tree } from "viewer/model/types/tree_types";
import type { WebknossosState } from "viewer/store";
import {
  applyAddUserBoundingBox,
  applyDeleteUserBoundingBox,
  applyUpdateUserBoundingBox,
} from "./bounding_box";

export function applySkeletonUpdateActionsFromServer(
  actions: ApplicableSkeletonUpdateAction[],
  newState: WebknossosState,
): { value: WebknossosState } {
  for (const ua of actions) {
    switch (ua.name) {
      case "createTree": {
        const { id, ...rest } = ua.value;
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
        // todop
        break;
      }
      case "createNode": {
        const { treeId, ...serverNode } = ua.value;
        // eslint-disable-next-line no-loop-func
        const { position: untransformedPosition, resolution: mag, ...node } = serverNode;
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
              cachedMaxNodeId: { $set: node.id },
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
        newState = update(newState, {
          annotation: {
            skeleton: {
              trees: {
                [tree.treeId]: { $set: newTree },
              },
            },
          },
        });
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
