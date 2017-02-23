/**
 * settings_reducer.js
 * @flow
 */

import update from "immutability-helper";
import TracingParser from "oxalis/model/skeletontracing/tracingparser";
import type { OxalisState } from "oxalis/store";
import type { SkeletonTracingActionTypes } from "oxalis/model/actions/skeletontracing_actions";

function SkeletonTracingReducer(state: OxalisState, action: SkeletonTracingActionTypes): OxalisState {
  switch (action.type) {
    case "INITIALIZE_SKELETONTRACING": {
      const skeletonTracing = TracingParser.parse(action.tracing);
      return update(state, { skeletonTracing: { $set: skeletonTracing } });
    }

    case "CREATE_NODE": {
      const { position, rotation, viewport, resolution } = action;
      const { fourBit, interpolation } = state.datasetConfiguration;

      state.skeletonTracing.addNode(
        position,
        rotation,
        viewport,
        resolution,
        fourBit ? 4 : 8,
        interpolation,
      );
      break;
    }

    case "DELETE_NODE": {
      state.skeletonTracing.deleteActiveNode();
      state.skeletonTracing.centerActiveNode();
      break;
    }

    case "SET_ACTIVE_NODE": {
      state.skeletonTracing.setActiveNode(action.nodeId, action.shouldMergeTree);
      break;
    }

    case "SET_ACTIVE_NODE_RADIUS": {
      state.skeletonTracing.setActiveNodeRadius(action.radius);
      break;
    }

    case "CREATE_BRANCHPOINT": {
      state.skeletonTracing.pushBranch();
      break;
    }

    case "DELETE_BRANCHPOINT": {
      state.skeletonTracing.pushBranch();
      break;
    }

    case "CREATE_TREE": {
      state.skeletonTracing.createNewTree();
      break;
    }

    case "DELETE_TREE": {
      state.skeletonTracing.deleteTree();
      break;
    }

    case "SET_ACTIVE_TREE": {
      state.skeletonTracing.setActiveTree(action.treeId);
      state.skeletonTracing.centerActiveNode();
      break;
    }

    case "SET_TREE_NAME": {
      state.skeletonTracing.setTreeName(action.name);
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
