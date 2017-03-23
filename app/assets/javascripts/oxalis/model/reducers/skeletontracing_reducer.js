/**
 * settings_reducer.js
 * @flow
 */
import _ from "lodash";
import update from "immutability-helper";
import Utils from "libs/utils";
import { createBranchPoint, deleteBranchPoint, createNode, createTree, deleteTree, deleteNode, shuffleTreeColor, createComment, deleteComment, mergeTrees } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import { findTreeByNodeId, getTree, getNodeAndTree } from "oxalis/model/accessors/skeletontracing_accessor";
import type { OxalisState, SkeletonTracingType } from "oxalis/store";
import type { SkeletonTracingActionTypes } from "oxalis/model/actions/skeletontracing_actions";
import type { ActionWithTimestamp } from "oxalis/model/helpers/timestamp_middleware";


function SkeletonTracingReducer(state: OxalisState, action: ActionWithTimestamp<SkeletonTracingActionTypes>): OxalisState {
  const { timestamp } = action;
  switch (action.type) {
    case "INITIALIZE_SKELETONTRACING": {
      const restrictions = Object.assign({}, action.tracing.restrictions, action.tracing.content.settings);
      const { contentData } = action.tracing.content;

      const trees = _.keyBy(contentData.trees.map(tree => update(tree, {
        treeId: { $set: tree.id },
        nodes: { $set: _.keyBy(tree.nodes, "id") },
        color: { $set: tree.color.slice(0, 3) },
      })), "id");

      const activeNodeId = contentData.activeNode ? contentData.activeNode : null;
      const activeTree = activeNodeId ? findTreeByNodeId(trees, activeNodeId).get() : null;

      let activeTreeId = null;
      if (activeTree != null) {
        activeTreeId = activeTree.treeId;
      } else {
        const lastTree = _.maxBy(_.values(trees), tree => tree.id);
        if (lastTree != null) {
          activeTreeId = lastTree.treeId;
        }
      }

      const skeletonTracing: SkeletonTracingType = {
        activeNodeId,
        activeTreeId,
        restrictions,
        trees,
        name: action.tracing.dataSetName,
        tracingType: action.tracing.typ,
        id: action.tracing.id,
        version: action.tracing.version,
      };

      return update(state, { skeletonTracing: { $set: skeletonTracing } });
    }

    case "CREATE_NODE": {
      const { position, rotation, viewport, resolution, treeId } = action;

      return getTree(state.skeletonTracing, treeId)
        .chain(tree =>
          createNode(state, tree, position, rotation, viewport, resolution, timestamp)
            .map(([node, edges]) =>
              update(state, { skeletonTracing: {
                trees: {
                  [tree.treeId]: {
                    nodes: { [node.id]: { $set: node } },
                    edges: { $set: edges },
                  },
                },
                activeNodeId: { $set: node.id },
                activeTreeId: { $set: tree.treeId },
              } })))
        .getOrElse(state);
    }

    case "DELETE_NODE": {
      return getNodeAndTree(state.skeletonTracing, action.nodeId, action.treeId)
        .chain(([tree, node]) => deleteNode(state, tree, node, timestamp))
        .map(([trees, newActiveTreeId, newActiveNodeId]) =>
          update(state, { skeletonTracing: {
            trees: { $set: trees },
            activeNodeId: { $set: newActiveNodeId },
            activeTreeId: { $set: newActiveTreeId },
          } }),
        ).getOrElse(state);
    }

    case "SET_ACTIVE_NODE": {
      return findTreeByNodeId(state.skeletonTracing.trees, action.nodeId)
        .map(tree => update(state, { skeletonTracing: {
          activeNodeId: { $set: action.nodeId },
          activeTreeId: { $set: tree.treeId },
        } }))
        .getOrElse(state);
    }

    case "SET_ACTIVE_NODE_RADIUS": {
      return getNodeAndTree(state.skeletonTracing, null, null)
        .map(([tree, node]) => update(state, { skeletonTracing: { trees: {
          [tree.treeId]: { nodes: { [node.id]: { radius: { $set: action.radius } } } },
        } } }))
        .getOrElse(state);
    }

    case "CREATE_BRANCHPOINT": {
      return getNodeAndTree(state.skeletonTracing, action.nodeId, action.treeId)
        .chain(([tree, node]) =>
          createBranchPoint(state.skeletonTracing, tree, node, timestamp)
            .map(branchPoint =>
              update(state, { skeletonTracing: {
                trees: { [tree.treeId]: { branchPoints: { $push: [branchPoint] } } },
              } })))
        .getOrElse(state);
    }

    case "DELETE_BRANCHPOINT": {
      return deleteBranchPoint(state.skeletonTracing)
        .map(([branchPoints, treeId, newActiveNodeId]) =>
          update(state, { skeletonTracing: {
            trees: { [treeId]: { branchPoints: { $set: branchPoints } } },
            activeNodeId: { $set: newActiveNodeId },
          } }))
        .getOrElse(state);
    }

    case "CREATE_TREE": {
      return createTree(state, timestamp)
        .map(tree =>
          update(state, { skeletonTracing: {
            trees: { [tree.treeId]: { $set: tree } },
            activeNodeId: { $set: null },
            activeTreeId: { $set: tree.treeId },
          } }))
        .getOrElse(state);
    }

    case "DELETE_TREE": {
      return getTree(state.skeletonTracing, action.treeId)
        .chain(tree => deleteTree(state, tree, timestamp))
        .map(([trees, newActiveTreeId, newActiveNodeId]) =>
          update(state, { skeletonTracing: {
            trees: { $set: trees },
            activeTreeId: { $set: newActiveTreeId },
            activeNodeId: { $set: newActiveNodeId },
          } }))
        .getOrElse(state);
    }

    case "SET_ACTIVE_TREE": {
      const { trees } = state.skeletonTracing;

      return getTree(state.skeletonTracing, action.treeId)
        .map((tree) => {
          const newActiveNodeId = _.max(_.map(trees[tree.treeId].nodes, "id")) || null;

          return update(state, { skeletonTracing: {
            activeNodeId: { $set: newActiveNodeId },
            activeTreeId: { $set: tree.treeId },
          } });
        })
        .getOrElse(state);
    }

    case "MERGE_TREES": {
      const { sourceNodeId, targetNodeId } = action;
      return mergeTrees(state.skeletonTracing, sourceNodeId, targetNodeId)
        .map(([trees, newActiveTreeId, newActiveNodeId]) =>
          update(state, { skeletonTracing: {
            trees: { $set: trees },
            activeNodeId: { $set: newActiveNodeId },
            activeTreeId: { $set: newActiveTreeId },
          } }))
        .getOrElse(state);
    }

    case "SET_TREE_NAME": {
      return getTree(state.skeletonTracing, action.treeId)
        .map((tree) => {
          const defaultName = `Tree${Utils.zeroPad(tree.treeId, 3)}`;
          const newName = action.name || defaultName;
          return update(state, { skeletonTracing: { trees: { [tree.treeId]: { name: { $set: newName } } } } });
        })
        .getOrElse(state);
    }

    case "SELECT_NEXT_TREE": {
      const { activeTreeId, trees } = state.skeletonTracing;
      if (_.values(trees).length === 0) return state;

      const increaseDecrease = action.forward ? 1 : -1;
      const maxTreeId = _.max(_.map(trees, "treeId"));
      const newActiveTreeId = _.clamp((activeTreeId || 0) + increaseDecrease, 0, maxTreeId);

      return update(state, { skeletonTracing: { activeTreeId: { $set: newActiveTreeId } } });
    }

    case "SHUFFLE_TREE_COLOR": {
      return getTree(state.skeletonTracing, action.treeId)
        .chain(tree => shuffleTreeColor(state.skeletonTracing, tree))
        .map(([tree, treeId]) =>
          update(state, { skeletonTracing: { trees: { [treeId]: { $set: tree } } } }))
        .getOrElse(state);
    }

    case "CREATE_COMMENT": {
      return getNodeAndTree(state.skeletonTracing, action.nodeId, action.treeId)
        .chain(([tree, node]) =>
          createComment(state.skeletonTracing, tree, node, action.commentText)
            .map(comments =>
              update(state, { skeletonTracing: {
                trees: { [tree.treeId]: { comments: { $set: comments } } },
              } })))
        .getOrElse(state);
    }

    case "DELETE_COMMENT": {
      return getNodeAndTree(state.skeletonTracing, action.nodeId, action.treeId)
        .chain(([tree, node]) =>
          deleteComment(state.skeletonTracing, tree, node, action.commentText)
            .map(comments =>
              update(state, { skeletonTracing: {
                trees: { [tree.treeId]: { comments: { $set: comments } } },
              } })))
        .getOrElse(state);
    }

    case "SET_VERSION_NUMBER": {
      return update(state, { skeletonTracing: { version: { $set: action.version } } });
    }

    default:
      // pass;
  }

  return state;
}

export default SkeletonTracingReducer;
