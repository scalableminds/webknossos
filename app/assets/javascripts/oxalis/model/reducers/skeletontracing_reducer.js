/**
 * settings_reducer.js
 * @flow
 */
/* eslint-disable array-callback-return */

import _ from "lodash";
import update from "immutability-helper";
import Utils from "libs/utils";
import { createBranchPoint, deleteBranchPoint, createNode, createTree, deleteTree, deleteNode, shuffleTreeColor } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import type { OxalisState, TreeType } from "oxalis/store";
import type { SkeletonTracingActionTypes } from "oxalis/model/actions/skeletontracing_actions";


function SkeletonTracingReducer(state: OxalisState, action: SkeletonTracingActionTypes): OxalisState {
  switch (action.type) {

    case "INITIALIZE_SKELETONTRACING": {
      const restrictions = Object.assign({}, action.tracing.restrictions, action.tracing.content.settings);
      const activeNodeId = action.tracing.content.contentData.activeNode ? action.tracing.content.contentData.activeNode : 0;
      const activeTreeId = 0; // probably something else

      const skeletonTracing = {
        activeNodeId,
        activeTreeId,
        restrictions,
        name: action.tracing.dataSetName,
        trees: _.keyBy(action.tracing.content.contentData.trees, "id"),
        contentType: action.tracing.contentType,
        id: action.tracing.id,
      };

      // return update(state, { skeletonTracing: { $set: skeletonTracing } });
      return state;
    }

    case "CREATE_NODE": {
      const { position, rotation, viewport, resolution } = action;

      return createNode(state.skeletonTracing, position, rotation, viewport, resolution).map(([node, edges]) => {
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
      const newActiveTree = _.find(state.skeletonTracing.trees, (tree: TreeType) => _.map(tree.nodes, "id").includes(action.nodeId));

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
      return createBranchPoint(state.skeletonTracing).map((branchPoint) => {
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
      return createTree(state.skeletonTracing).map(tree =>

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

    case "SET_COMMENT": {
      // TODO
      break;
    }

    default:
      // pass;
  }

  return state;
}

export default SkeletonTracingReducer;
