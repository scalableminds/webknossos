/**
 * settings_reducer.js
 * @flow
 */
/* eslint-disable array-callback-return */

import _ from "lodash";
import update from "immutability-helper";
import Utils from "libs/utils";
import TracingParser from "oxalis/model/skeletontracing/tracingparser";
import { createBranchPoint, deleteBranchPoint, createNode, createTree, deleteTree, deleteNode } from "oxalis/model/skeletontracing/foo";
import type { OxalisState } from "oxalis/store";
import type { SkeletonTracingActionTypes } from "oxalis/model/actions/skeletontracing_actions";


function SkeletonTracingReducer(state: OxalisState, action: SkeletonTracingActionTypes): OxalisState {
  switch (action.type) {

    case "INITIALIZE_SKELETONTRACING": {
      const skeletonTracing = TracingParser.parse(action.tracing);
      const restrictions = Object.assign({}, action.tracing.restrictions, action.tracing.content.settings);

      return update(state, { skeletonTracing: {
        $set: skeletonTracing,
        restrictions: { $set: restrictions } },
      });
    }

    case "CREATE_NODE": {
      const { position, rotation } = action;

      return createNode(state.skeletonTracing, position, rotation).map((node, edges) => {
        const { activeTreeId } = state.skeletonTracing;
        return update(state, { skeletonTracing: {
          trees: { [activeTreeId]: {
            nodes: { [node.id]: { $set: node } } },
            edges: { $set: edges },
          },
          activeNodeId: { $set: node.id },
        } });
      }).getOrElse(state);
    }

    case "DELETE_NODE": {
      return deleteNode(state.skeletonTracing).map(([trees, newActiveNodeId, newActiveTreeId]) => {

        return update(state, { skeletonTracing: {
          trees: { $set: trees },
          activeNodeId: { $set: newActiveNodeId },
          activeTreeId: { $set: newActiveTreeId },
        } });
      }).getOrElse(state);
    }

    case "SET_ACTIVE_NODE": {
      if (action.shouldMergeTree) {
        debugger;
        Error("who is call this?");
      }

      const newActiveTreeId = _.filter(state.skeletonTracing.trees, tree => tree.nodes[action.nodeId]).treeId;

      return update(state, { skeletonTracing: {
        activeNodeId: { $set: action.nodeId },
        activeTreeId: { $set: newActiveTreeId },
      } });
    }

    case "SET_ACTIVE_NODE_RADIUS": {
      const { activeNodeId, activeTreeId } = state.skeletonTracing;
      return update(state, { skeletonTracing: { trees: { [activeTreeId]: { nodes: { [activeNodeId]: { radius: { $set: action.radius } } } } } } });
    }

    case "CREATE_BRANCHPOINT": {
      return createBranchPoint(state.skeletonTracing).map((branchPoint) => {
        const { activeTreeId } = state.skeletontracing;
        return update(state, { skeletonTracing: { trees: { [activeTreeId]: { branchPoints: { $push: branchPoint } } } } });
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
          trees: { $push: tree },
          activeNodeId: { $set: null },
          activeTreeId: { $set: tree.treeId },
        } }),
      ).getOrElse(state);
    }

    case "DELETE_TREE": {
      return deleteTree(state.skeletonTracing).map((trees, newActiveTreeId, newActiveNodeId) =>

        update(state, { skeletonTracing: {
          trees: { $set: trees } },
          activeTreeId: { $set: newActiveTreeId },
          activeNodeId: { $set: newActiveNodeId },
        }),
      ).getOrElse(state);
    }

    case "SET_ACTIVE_TREE": {
      const { trees } = state.skeletonTracing;

      const newActiveTreeId = action.treeId;
      const newActiveNodeId = trees[newActiveTreeId].nodes[0];

      return update(state, { skeletonTracing: {
        activeNodeId: { $set: newActiveNodeId },
        activeTreeId: { $set: newActiveTreeId },
      } });
    }

    case "SET_TREE_NAME": {
      const { activeTreeId } = state.skeletonTracing;

      if (state.skeletonTracing[activeTreeId]) {
        const defaultName = `Tree${Utils.zeroPad(activeTreeId, 2)}`;
        const newName = action.name || defaultName;
        return update(state, { skeletontracing: { trees: { [activeTreeId]: { name: { $set: newName } } } } });
      }
      break;
    }

    case "SELECT_NEXT_TREE": {
      state.skeletonTracing.selectNextTree(action.forward);
      break;
    }

    case "SHUFFLE_TREE_COLOR": {
      state.skeletonTracing.shuffleTreeColor();
      break;
    }

    case "SHUFFLE_ALL_TREE_COLORS": {
      state.skeletonTracing.shuffleAllTreeColors();
      break;
    }

    case "SET_COMMENT": {
      state.skeletonTracing.setCommentForNode(action.nodeId, action.commentText);
      break;
    }

    default:
      // pass;
  }

  return state;
}

export default SkeletonTracingReducer;
