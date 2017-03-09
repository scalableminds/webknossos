/**
 * settings_reducer.js
 * @flow
 */
/* eslint-disable array-callback-return */
import _ from "lodash";
import update from "immutability-helper";
import Utils from "libs/utils";
import { createBranchPoint, deleteBranchPoint, createNode, createTree, deleteTree, deleteNode, shuffleTreeColor, createComment, deleteComment, findTree, mergeTrees } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import type { OxalisState, TreeType, SkeletonTracingType } from "oxalis/store";
import type { SkeletonTracingActionTypes } from "oxalis/model/actions/skeletontracing_actions";
import type { ActionWithTimestamp } from "oxalis/model/helpers/timestamp_middleware";
import ColorGenerator from "libs/color_generator";

function SkeletonTracingReducer(state: OxalisState, action: ActionWithTimestamp<SkeletonTracingActionTypes>): OxalisState {
  const { timestamp } = action;
  switch (action.type) {
    case "INITIALIZE_SKELETONTRACING": {
      const restrictions = Object.assign({}, action.tracing.restrictions, action.tracing.content.settings);
      const { contentData } = action.tracing.content;

      const rawTrees = contentData.trees.length > 0 ?
        contentData.trees : [{
          id: 1,
          color: ColorGenerator.distinctColorForId(1),
          name: "",
          timestamp,
          comments: [],
          branchPoints: [],
          edges: [],
          nodes: {},
        }];

      const trees = _.keyBy(rawTrees.map(tree => update(tree, {
        treeId: { $set: tree.id },
        nodes: { $set: _.keyBy(tree.nodes, "id") },
      })), "id");

      const activeNodeId = contentData.activeNode ? contentData.activeNode : null;
      const activeTree = activeNodeId ? findTree(trees, activeNodeId) : null;

      let activeTreeId;
      if (activeTree != null) {
        activeTreeId = activeTree.treeId;
      } else {
        const lastTree = _.maxBy(_.values(trees), tree => tree.id);
        activeTreeId = lastTree.treeId;
      }

      const skeletonTracing: SkeletonTracingType = {
        activeNodeId,
        activeTreeId,
        restrictions,
        trees,
        name: action.tracing.dataSetName,
        contentType: action.tracing.contentType,
        id: action.tracing.id,
      };

      return update(state, { skeletonTracing: { $set: skeletonTracing } });
    }

    case "CREATE_NODE": {
      const { position, rotation, viewport, resolution } = action;

      return createNode(state.skeletonTracing, position, rotation, viewport, resolution, timestamp).map(([node, edges]) => {
        const { activeTreeId } = state.skeletonTracing;

        return update(state, { skeletonTracing: {
          trees: {
            [activeTreeId]: {
              nodes: { [node.id]: { $set: node } },
              edges: { $set: edges },
            },
          },
          activeNodeId: { $set: node.id },
        } });
      }).getOrElse(state);
    }

    case "DELETE_NODE": {
      return deleteNode(state.skeletonTracing).map(([trees, newActiveNodeId, newActiveTreeId]) =>

        update(state, { skeletonTracing: {
          trees: { $set: trees },
          activeNodeId: { $set: newActiveNodeId },
          activeTreeId: { $set: newActiveTreeId },
        } }),
      ).getOrElse(state);
    }

    case "SET_ACTIVE_NODE": {
      const newActiveTree = findTree(state.skeletonTracing.trees, action.nodeId);

      if (newActiveTree) {
        return update(state, { skeletonTracing: {
          activeNodeId: { $set: action.nodeId },
          activeTreeId: { $set: newActiveTree.treeId },
        } });
      }

      return state;
    }

    case "SET_ACTIVE_NODE_RADIUS": {
      const { activeNodeId, activeTreeId } = state.skeletonTracing;
      if (_.isNumber(activeNodeId)) {
        return update(state, { skeletonTracing: { trees: { [activeTreeId]: { nodes: { [activeNodeId]: { radius: { $set: action.radius } } } } } } });
      }

      return state;
    }

    case "CREATE_BRANCHPOINT": {
      return createBranchPoint(state.skeletonTracing, timestamp).map((branchPoint) => {
        const { activeTreeId } = state.skeletonTracing;
        return update(state, { skeletonTracing: { trees: { [activeTreeId]: { branchPoints: { $push: [branchPoint] } } } } });
      }).getOrElse(state);
    }

    case "DELETE_BRANCHPOINT": {
      return deleteBranchPoint(state.skeletonTracing).map(([branchPoints, treeId, newActiveNodeId]) =>

        update(state, { skeletonTracing: {
          trees: { [treeId]: { branchPoints: { $set: branchPoints } } },
          activeNodeId: { $set: newActiveNodeId },
        } }),
      ).getOrElse(state);
    }

    case "CREATE_TREE": {
      return createTree(state.skeletonTracing, timestamp).map(tree =>

        update(state, { skeletonTracing: {
          trees: { [tree.treeId]: { $set: tree } },
          activeNodeId: { $set: null },
          activeTreeId: { $set: tree.treeId },
        } }),
      ).getOrElse(state);
    }

    case "DELETE_TREE": {
      return deleteTree(state.skeletonTracing).map(([trees, newActiveTreeId, newActiveNodeId]) =>

        update(state, { skeletonTracing: {
          trees: { $set: trees },
          activeTreeId: { $set: newActiveTreeId },
          activeNodeId: { $set: newActiveNodeId },
        } }),
      ).getOrElse(state);
    }

    case "SET_ACTIVE_TREE": {
      const { trees } = state.skeletonTracing;
      const newActiveTreeId = action.treeId;

      if (trees[newActiveTreeId]) {
        const newActiveNodeId = _.max(_.map(trees[newActiveTreeId].nodes, "id")) || null;

        return update(state, { skeletonTracing: {
          activeNodeId: { $set: newActiveNodeId },
          activeTreeId: { $set: newActiveTreeId },
        } });
      }

      return state;
    }

    case "MERGE_TREES": {
      const { sourceNodeId, targetNodeId } = action;

      return mergeTrees(state.skeletonTracing, sourceNodeId, targetNodeId).map(([trees, newActiveTreeId, newActiveNodeId]) =>
        update(state, { skeletonTracing: {
          trees: { $set: trees },
          activeNodeId: { $set: newActiveNodeId },
          activeTreeId: { $set: newActiveTreeId },
        } }),
      ).getOrElse(state);
    }

    case "SET_TREE_NAME": {
      const { activeTreeId } = state.skeletonTracing;

      if (state.skeletonTracing.trees[activeTreeId]) {
        const defaultName = `Tree${Utils.zeroPad(activeTreeId, 3)}`;
        const newName = action.name || defaultName;
        return update(state, { skeletonTracing: { trees: { [activeTreeId]: { name: { $set: newName } } } } });
      }

      return state;
    }

    case "SELECT_NEXT_TREE": {
      const { activeTreeId, trees } = state.skeletonTracing;

      const increaseDecrease = action.forward ? 1 : -1;
      const maxTreeId = _.size(trees);
      const newActiveTreeId = _.clamp(activeTreeId + increaseDecrease, 0, maxTreeId);

      return update(state, { skeletonTracing: { activeTreeId: { $set: newActiveTreeId } } });
    }

    case "SHUFFLE_TREE_COLOR": {
      return shuffleTreeColor(state.skeletonTracing, action.treeId).map(([tree, treeId]) =>
        update(state, { skeletonTracing: { trees: { [treeId]: { $set: tree } } } }),
      ).getOrElse(state);
    }

    case "CREATE_COMMENT": {
      return createComment(state.skeletonTracing, action.commentText).map((comments) => {
        const { activeTreeId } = state.skeletonTracing;
        return update(state, { skeletonTracing: { trees: { [activeTreeId]: { comments: { $set: comments } } } } });
      }).getOrElse(state);
    }

    case "DELETE_COMMENT": {
      return deleteComment(state.skeletonTracing, action.commentText).map((comments) => {
        const { activeTreeId } = state.skeletonTracing;
        return update(state, { skeletonTracing: { trees: { [activeTreeId]: { comments: { $set: comments } } } } });
      }).getOrElse(state);
    }

    default:
      // pass;
  }

  return state;
}

export default SkeletonTracingReducer;
