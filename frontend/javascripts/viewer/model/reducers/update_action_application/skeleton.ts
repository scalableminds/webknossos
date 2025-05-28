import update from "immutability-helper";
import { enforceSkeletonTracing, getTree } from "viewer/model/accessors/skeletontracing_accessor";
import type { ApplicableSkeletonUpdateAction } from "viewer/model/sagas/update_actions";
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
      // case "createTree": {
      //   const { id, color, name, comments, timestamp, branchPoints, isVisible, groupId } =
      //     ua.value;
      //   newState = update(newState, {
      //     tracing: {
      //       skeleton: {
      //         trees: {
      //           [id]: {
      //             $set: {
      //               name,
      //               treeId: id,
      //               nodes: new DiffableMap(),
      //               timestamp,
      //               color,
      //               branchPoints,
      //               edges: new EdgeCollection(),
      //               comments,
      //               isVisible,
      //               groupId,
      //             },
      //           },
      //         },
      //       },
      //     },
      //   });
      //   break;
      // }
      case "createNode": {
        if (newState.annotation.skeleton == null) {
          continue;
        }

        const { treeId, ...serverNode } = ua.value;
        // eslint-disable-next-line no-loop-func
        const { position: untransformedPosition, resolution: mag, ...node } = serverNode;
        const clientNode = { untransformedPosition, mag, ...node };

        const tree = getTree(newState.annotation.skeleton, treeId);
        if (tree == null) {
          // todop: escalate error?
          continue;
        }
        const diffableNodeMap = tree.nodes;
        const newDiffableMap = diffableNodeMap.set(node.id, clientNode);
        const newTree = update(tree, {
          nodes: { $set: newDiffableMap },
        });
        newState = update(newState, {
          annotation: {
            skeleton: {
              trees: {
                [tree.treeId]: { $set: newTree },
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
