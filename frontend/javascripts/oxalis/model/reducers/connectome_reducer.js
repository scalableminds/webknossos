// @flow

import Maybe from "data.maybe";
import update from "immutability-helper";

import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState, SkeletonTracing } from "oxalis/store";
import {
  addTreesAndGroups,
  deleteTree,
} from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import { getTree } from "oxalis/model/accessors/skeletontracing_accessor";
import Constants from "oxalis/constants";

function getSkeletonTracingForConnectome(
  state: OxalisState,
  layerName: string,
): Maybe<SkeletonTracing> {
  if (state.localSegmentationData[layerName].connectomeData.skeleton != null) {
    return Maybe.Just(state.localSegmentationData[layerName].connectomeData.skeleton);
  }
  return Maybe.Nothing();
}

function ConnectomeReducer(state: OxalisState, action: Action): OxalisState {
  switch (action.type) {
    case "INITIALIZE_CONNECTOME_TRACING": {
      const { layerName } = action;
      const skeletonTracing: SkeletonTracing = {
        createdTimestamp: Date.now(),
        type: "skeleton",
        activeNodeId: null,
        cachedMaxNodeId: Constants.MIN_NODE_ID - 1,
        activeTreeId: null,
        activeGroupId: null,
        trees: {},
        treeGroups: [],
        tracingId: "connectome-tracing-data",
        version: 1,
        boundingBox: null,
        userBoundingBoxes: [],
        navigationList: { list: [], activeIndex: -1 },
        showSkeletons: true,
      };

      return update(state, {
        localSegmentationData: {
          [layerName]: { connectomeData: { skeleton: { $set: skeletonTracing } } },
        },
      });
    }
    default:
    // pass
  }

  switch (action.type) {
    case "ADD_CONNECTOME_TREES": {
      const { trees, layerName } = action;
      return getSkeletonTracingForConnectome(state, layerName)
        .map(skeletonTracing =>
          addTreesAndGroups(skeletonTracing, trees, [])
            .map(([updatedTrees, _, newMaxNodeId]) =>
              update(state, {
                localSegmentationData: {
                  [layerName]: {
                    connectomeData: {
                      skeleton: {
                        trees: { $merge: updatedTrees },
                        cachedMaxNodeId: { $set: newMaxNodeId },
                      },
                    },
                  },
                },
              }),
            )
            .getOrElse(state),
        )
        .getOrElse(state);
    }

    case "DELETE_CONNECTOME_TREE": {
      const { treeId, layerName } = action;
      return getSkeletonTracingForConnectome(state, layerName)
        .map(skeletonTracing =>
          getTree(skeletonTracing, treeId)
            .chain(tree => deleteTree(skeletonTracing, tree))
            .map(([trees, _newActiveTreeId, _newActiveNodeId, newMaxNodeId]) =>
              update(state, {
                localSegmentationData: {
                  [layerName]: {
                    connectomeData: {
                      skeleton: {
                        trees: { $set: trees },
                        cachedMaxNodeId: { $set: newMaxNodeId },
                      },
                    },
                  },
                },
              }),
            )
            .getOrElse(state),
        )
        .getOrElse(state);
    }

    default:
      return state;
  }
}

export default ConnectomeReducer;
