// @flow

import Maybe from "data.maybe";
import _ from "lodash";
import update from "immutability-helper";

import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState, SkeletonTracing, TreeMap } from "oxalis/store";
import {
  addTreesAndGroups,
  getMaximumNodeId,
} from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import { updateKey3 } from "oxalis/model/helpers/deep_update";
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

function setConnectomeTreesVisibilityReducer(
  state: OxalisState,
  layerName: string,
  treeIds: Array<number>,
  visibility: boolean,
): OxalisState {
  const updateTreesObject = {};
  const isVisibleUpdater = {
    isVisible: { $set: visibility },
  };
  treeIds.forEach(treeId => {
    updateTreesObject[treeId] = isVisibleUpdater;
  });

  return update(state, {
    localSegmentationData: {
      [layerName]: {
        connectomeData: {
          skeleton: {
            trees: updateTreesObject,
          },
        },
      },
    },
  });
}

export function deleteConnectomeTrees(
  skeletonTracing: SkeletonTracing,
  treeIds: Array<number>,
): Maybe<[TreeMap, number]> {
  // Delete trees
  const newTrees = _.omit(skeletonTracing.trees, treeIds);
  const newMaxNodeId = getMaximumNodeId(newTrees);

  return Maybe.Just([newTrees, newMaxNodeId]);
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
            .map(([updatedTrees, _treeGroups, newMaxNodeId]) =>
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

    case "DELETE_CONNECTOME_TREES": {
      const { treeIds, layerName } = action;
      return getSkeletonTracingForConnectome(state, layerName)
        .map(skeletonTracing =>
          deleteConnectomeTrees(skeletonTracing, treeIds)
            .map(([trees, newMaxNodeId]) =>
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

    case "SET_CONNECTOME_TREES_VISIBILITY": {
      const { treeIds, isVisible, layerName } = action;
      return getSkeletonTracingForConnectome(state, layerName)
        .map(_skeletonTracing =>
          setConnectomeTreesVisibilityReducer(state, layerName, treeIds, isVisible),
        )
        .getOrElse(state);
    }

    case "UPDATE_CONNECTOME_FILE_LIST": {
      const { layerName, connectomeFiles } = action;
      return updateKey3(state, "localSegmentationData", layerName, "connectomeData", {
        availableConnectomeFiles: connectomeFiles,
      });
    }

    case "UPDATE_CURRENT_CONNECTOME_FILE": {
      const { layerName, connectomeFileName } = action;
      const availableConnectomeFiles =
        state.localSegmentationData[layerName].connectomeData.availableConnectomeFiles;
      if (availableConnectomeFiles == null) return state;

      const connectomeFile = availableConnectomeFiles.find(
        el => el.connectomeFileName === connectomeFileName,
      );
      return updateKey3(state, "localSegmentationData", layerName, "connectomeData", {
        currentConnectomeFile: connectomeFile,
      });
    }

    case "SET_ACTIVE_CONNECTOME_AGGLOMERATE_IDS": {
      const { layerName, agglomerateIds } = action;
      return updateKey3(state, "localSegmentationData", layerName, "connectomeData", {
        activeAgglomerateIds: agglomerateIds,
      });
    }

    case "REMOVE_CONNECTOME_TRACING": {
      const { layerName } = action;
      return updateKey3(state, "localSegmentationData", layerName, "connectomeData", {
        skeleton: null,
      });
    }

    default:
      return state;
  }
}

export default ConnectomeReducer;
