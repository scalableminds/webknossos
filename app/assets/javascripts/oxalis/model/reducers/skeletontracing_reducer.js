/**
 * skeletontracing_reducer.js
 * @flow
 */

import _ from "lodash";
import update from "immutability-helper";
import Utils from "libs/utils";
import ColorGenerator from "libs/color_generator";
import { createBranchPoint, deleteBranchPoint, createNode, createTree, deleteTree, deleteNode, shuffleTreeColor, createComment, deleteComment, mergeTrees, toggleAllTreesReducer } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import { convertBoundingBox } from "oxalis/model/reducers/reducer_helpers";
import { getSkeletonTracing, findTreeByNodeId, getTree, getNodeAndTree } from "oxalis/model/accessors/skeletontracing_accessor";
import Constants from "oxalis/constants";
import type { OxalisState, SkeletonTracingType } from "oxalis/store";
import type { ActionType } from "oxalis/model/actions/actions";
import Maybe from "data.maybe";
import ErrorHandling from "libs/error_handling";

function SkeletonTracingReducer(state: OxalisState, action: ActionType): OxalisState {
  switch (action.type) {
    case "INITIALIZE_SKELETONTRACING": {
      const restrictions = Object.assign({}, action.tracing.restrictions, action.tracing.content.settings);
      const { contentData } = action.tracing.content;

      const trees = _.keyBy(contentData.trees.map(tree => update(tree, {
        treeId: { $set: tree.id },
        nodes: { $set: _.keyBy(tree.nodes, "id") },
        color: { $set: tree.color || ColorGenerator.distinctColorForId(tree.id) },
        isVisible: {$set: true},
      })), "id");

      const activeNodeIdMaybe = Maybe.fromNullable(contentData.activeNode);
      let cachedMaxNodeId = _.max(_.flatMap(trees, __ => _.map(__.nodes, node => node.id)));
      cachedMaxNodeId = cachedMaxNodeId != null ? cachedMaxNodeId : Constants.MIN_NODE_ID - 1;

      let activeNodeId = Utils.toNullable(activeNodeIdMaybe);
      const activeTreeIdMaybe = activeNodeIdMaybe
        .chain((nodeId) => {
          // use activeNodeId to find active tree
          const treeIdMaybe = findTreeByNodeId(trees, nodeId).map(tree => tree.treeId);
          if (treeIdMaybe.isNothing) {
            // There is an activeNodeId without a corresponding tree.
            // Log this, since this shouldn't happen, but clear the activeNodeId
            // so that wk is usable.
            ErrorHandling.assert(
              false,
             `This tracing was initialized with an active node ID, which does not
              belong to any tracing (nodeId: ${nodeId}). WebKnossos will fall back to
              the last tree instead.`,
              null,
              true,
            );
            activeNodeId = null;
          }
          return treeIdMaybe;
        }).orElse(() => {
          // use last tree for active tree
          const lastTree = Maybe.fromNullable(_.maxBy(_.values(trees), tree => tree.id));
          return lastTree.map(t => t.treeId);
        });
      const activeTreeId = Utils.toNullable(activeTreeIdMaybe);

      const skeletonTracing: SkeletonTracingType = {
        type: "skeleton",
        activeNodeId,
        cachedMaxNodeId,
        activeTreeId,
        restrictions,
        trees,
        name: action.tracing.name,
        tracingType: action.tracing.typ,
        tracingId: action.tracing.id,
        version: action.tracing.version,
        boundingBox: convertBoundingBox(action.tracing.content.boundingBox),
      };

      return update(state, { tracing: { $set: skeletonTracing } });
    }
    default:
      // pass
  }

  return getSkeletonTracing(state.tracing).map((skeletonTracing) => {
    switch (action.type) {
      case "CREATE_NODE": {
        const { position, rotation, viewport, resolution, treeId, timestamp } = action;

        return getTree(skeletonTracing, treeId)
          .chain(tree =>
            createNode(state, skeletonTracing, tree, position, rotation, viewport, resolution, timestamp)
              .map(([node, edges]) =>
                update(state, { tracing: {
                  trees: {
                    [tree.treeId]: {
                      nodes: { [node.id]: { $set: node } },
                      edges: { $set: edges },
                    },
                  },
                  activeNodeId: { $set: node.id },
                  cachedMaxNodeId: { $set: node.id },
                  activeTreeId: { $set: tree.treeId },
                } })))
          .getOrElse(state);
      }

      case "DELETE_NODE": {
        const { timestamp, nodeId, treeId } = action;
        return getNodeAndTree(skeletonTracing, nodeId, treeId)
          .chain(([tree, node]) => deleteNode(state, tree, node, timestamp))
          .map(([trees, newActiveTreeId, newActiveNodeId, newMaxNodeId]) =>
            update(state, { tracing: {
              trees: { $set: trees },
              activeNodeId: { $set: newActiveNodeId },
              activeTreeId: { $set: newActiveTreeId },
              cachedMaxNodeId: { $set: newMaxNodeId },
            } }),
          ).getOrElse(state);
      }

      case "SET_ACTIVE_NODE": {
        const { nodeId } = action;
        return findTreeByNodeId(skeletonTracing.trees, nodeId)
          .map(tree => update(state, { tracing: {
            activeNodeId: { $set: nodeId },
            activeTreeId: { $set: tree.treeId },
          } }))
          .getOrElse(state);
      }

      case "SET_NODE_RADIUS": {
        const { radius, nodeId, treeId } = action;
        return getNodeAndTree(skeletonTracing, nodeId, treeId)
          .map(([tree, node]) => update(state, { tracing: { trees: {
            [tree.treeId]: { nodes: { [node.id]: { radius: { $set: radius } } } },
          } } }))
          .getOrElse(state);
      }

      case "CREATE_BRANCHPOINT": {
        const { timestamp, nodeId, treeId } = action;
        return getNodeAndTree(skeletonTracing, nodeId, treeId)
          .chain(([tree, node]) =>
            createBranchPoint(skeletonTracing, tree, node, timestamp)
              .map(branchPoint =>
                update(state, { tracing: {
                  trees: { [tree.treeId]: { branchPoints: { $push: [branchPoint] } } },
                } })))
          .getOrElse(state);
      }

      case "DELETE_BRANCHPOINT": {
        return deleteBranchPoint(skeletonTracing)
          .map(([branchPoints, treeId, newActiveNodeId]) =>
            update(state, { tracing: {
              trees: { [treeId]: { branchPoints: { $set: branchPoints } } },
              activeNodeId: { $set: newActiveNodeId },
              activeTreeId: { $set: treeId },
            } }))
          .getOrElse(state);
      }

      case "CREATE_TREE": {
        const { timestamp } = action;
        return createTree(state, timestamp)
          .map(tree =>
            update(state, { tracing: {
              trees: { [tree.treeId]: { $set: tree } },
              activeNodeId: { $set: null },
              activeTreeId: { $set: tree.treeId },
            } }))
          .getOrElse(state);
      }

      case "DELETE_TREE": {
        const { timestamp, treeId } = action;
        return getTree(skeletonTracing, treeId)
          .chain(tree => deleteTree(state, tree, timestamp))
          .map(([trees, newActiveTreeId, newActiveNodeId, newMaxNodeId]) =>
            update(state, { tracing: {
              trees: { $set: trees },
              activeTreeId: { $set: newActiveTreeId },
              activeNodeId: { $set: newActiveNodeId },
              cachedMaxNodeId: { $set: newMaxNodeId },
            } }))
          .getOrElse(state);
      }

      case "TOGGLE_TREE": {
        const { treeId } = action;
        return getTree(skeletonTracing, treeId)
          .map(tree =>
            update(state, { tracing: {
              trees: {
                [tree.treeId]: {
                  isVisible: {
                    $apply: bool => !bool,
                  }
                },
              }
            } }))
          .getOrElse(state);
      }

      case "TOGGLE_ALL_TREES": {
        return toggleAllTreesReducer(state, skeletonTracing);
      }

      case "TOGGLE_INACTIVE_TREES": {
        return getTree(skeletonTracing).map(activeTree =>
          update(toggleAllTreesReducer(state, skeletonTracing), { tracing: {
            trees: {
              [activeTree.treeId]: {
                isVisible: {$set : true},
              },
            },
        }})).getOrElse(state);
      }

      case "SET_ACTIVE_TREE": {
        const { trees } = skeletonTracing;

        return getTree(skeletonTracing, action.treeId)
          .map((tree) => {
            const newActiveNodeId = _.max(_.map(trees[tree.treeId].nodes, "id")) || null;

            return update(state, { tracing: {
              activeNodeId: { $set: newActiveNodeId },
              activeTreeId: { $set: tree.treeId },
            } });
          })
          .getOrElse(state);
      }

      case "MERGE_TREES": {
        const { sourceNodeId, targetNodeId } = action;
        return mergeTrees(skeletonTracing, sourceNodeId, targetNodeId)
          .map(([trees, newActiveTreeId, newActiveNodeId]) =>
            update(state, { tracing: {
              trees: { $set: trees },
              activeNodeId: { $set: newActiveNodeId },
              activeTreeId: { $set: newActiveTreeId },
            } }))
          .getOrElse(state);
      }

      case "SET_TREE_NAME": {
        return getTree(skeletonTracing, action.treeId)
          .map((tree) => {
            const defaultName = `Tree${Utils.zeroPad(tree.treeId, 3)}`;
            const newName = action.name || defaultName;
            return update(state, { tracing: { trees: { [tree.treeId]: { name: { $set: newName } } } } });
          })
          .getOrElse(state);
      }

      case "SELECT_NEXT_TREE": {
        const { activeTreeId, trees } = skeletonTracing;
        if (_.values(trees).length === 0) return state;

        const increaseDecrease = action.forward ? 1 : -1;

        const orderAttribute = state.userConfiguration.sortTreesByName ? "name" : "timestamp";
        const treeIds = _.orderBy(_.values(trees), [orderAttribute]).map(t => t.treeId);

        // default to the first tree
        const activeTreeIdIndex = activeTreeId != null ? treeIds.indexOf(activeTreeId) : 0;

        // treeIds.length is taken into account in this calculation, because -1 % n == -1
        const newActiveTreeIdIndex = (activeTreeIdIndex + increaseDecrease + treeIds.length) % treeIds.length;

        const newActiveTreeId = treeIds[newActiveTreeIdIndex];
        const newActiveNodeId = _.max(_.map(trees[newActiveTreeId].nodes, "id")) || null;

        return update(state, { tracing: {
          activeTreeId: { $set: newActiveTreeId },
          activeNodeId: { $set: newActiveNodeId },
        } });
      }

      case "SHUFFLE_TREE_COLOR": {
        return getTree(skeletonTracing, action.treeId)
          .chain(tree => shuffleTreeColor(skeletonTracing, tree))
          .map(([tree, treeId]) =>
            update(state, { tracing: { trees: { [treeId]: { $set: tree } } } }))
          .getOrElse(state);
      }

      case "CREATE_COMMENT": {
        const { commentText, nodeId, treeId } = action;
        return getNodeAndTree(skeletonTracing, nodeId, treeId)
          .chain(([tree, node]) =>
            createComment(skeletonTracing, tree, node, commentText)
              .map(comments =>
                update(state, { tracing: {
                  trees: { [tree.treeId]: { comments: { $set: comments } } },
                } })))
          .getOrElse(state);
      }

      case "DELETE_COMMENT": {
        return getNodeAndTree(skeletonTracing, action.nodeId, action.treeId)
          .chain(([tree, node]) =>
            deleteComment(skeletonTracing, tree, node)
              .map(comments =>
                update(state, { tracing: {
                  trees: { [tree.treeId]: { comments: { $set: comments } } },
                } })))
          .getOrElse(state);
      }

      default:
        return state;
    }
  }).getOrElse(state);
}

export default SkeletonTracingReducer;
