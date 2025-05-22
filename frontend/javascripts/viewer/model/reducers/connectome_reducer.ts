import update from "immutability-helper";
import DiffableMap from "libs/diffable_map";
import Constants from "viewer/constants";
import type { Action } from "viewer/model/actions/actions";
import { updateKey3 } from "viewer/model/helpers/deep_update";
import {
  addTreesAndGroups,
  getMaximumNodeId,
} from "viewer/model/reducers/skeletontracing_reducer_helpers";
import { TreeMap } from "viewer/model/types/tree_types";
import type { SkeletonTracing, WebknossosState } from "viewer/store";

function getSkeletonTracingForConnectome(
  state: WebknossosState,
  layerName: string,
): SkeletonTracing | null {
  if (state.localSegmentationData[layerName].connectomeData.skeleton != null) {
    return state.localSegmentationData[layerName].connectomeData.skeleton;
  }

  return null;
}

function setConnectomeTreesVisibilityReducer(
  state: WebknossosState,
  layerName: string,
  treeIds: number[],
  visibility: boolean,
): WebknossosState {
  const skeletonTracing = getSkeletonTracingForConnectome(state, layerName);
  if (skeletonTracing == null) return state;

  let newTrees = skeletonTracing.trees;
  treeIds.forEach((treeId) => {
    newTrees = newTrees.set(treeId, { ...newTrees.getOrThrow(treeId), isVisible: visibility });
  });

  return update(state, {
    localSegmentationData: {
      [layerName]: {
        connectomeData: {
          skeleton: {
            trees: { $set: newTrees },
          },
        },
      },
    },
  });
}

export function deleteConnectomeTrees(
  skeletonTracing: SkeletonTracing,
  treeIds: number[],
): [TreeMap, number] | null {
  // Delete trees
  let newTrees = skeletonTracing.trees.clone();
  treeIds.forEach((treeId) => (newTrees = newTrees.delete(treeId)));

  const newMaxNodeId = getMaximumNodeId(newTrees);
  return [newTrees, newMaxNodeId];
}

function ConnectomeReducer(state: WebknossosState, action: Action): WebknossosState {
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
        trees: new TreeMap(),
        treeGroups: [],
        tracingId: "connectome-tracing-data",
        boundingBox: null,
        userBoundingBoxes: [],
        navigationList: {
          list: [],
          activeIndex: -1,
        },
        showSkeletons: true,
        additionalAxes: [],
      };

      return update(state, {
        localSegmentationData: {
          [layerName]: {
            connectomeData: {
              skeleton: {
                $set: skeletonTracing,
              },
            },
          },
        },
      });
    }

    default: // pass
  }

  switch (action.type) {
    case "ADD_CONNECTOME_TREES": {
      const { trees, layerName } = action;
      const skeletonTracing = getSkeletonTracingForConnectome(state, layerName);
      if (skeletonTracing == null) {
        return state;
      }

      const treesAndGroups = addTreesAndGroups(skeletonTracing, trees, []);
      if (treesAndGroups == null) {
        return state;
      }

      const [updatedTrees, _treeGroups, newMaxNodeId] = treesAndGroups;
      return update(state, {
        localSegmentationData: {
          [layerName]: {
            connectomeData: {
              skeleton: {
                trees: {
                  $set: DiffableMap.merge(skeletonTracing.trees, updatedTrees),
                },
                cachedMaxNodeId: {
                  $set: newMaxNodeId,
                },
              },
            },
          },
        },
      });
    }

    case "DELETE_CONNECTOME_TREES": {
      const { treeIds, layerName } = action;
      const skeletonTracing = getSkeletonTracingForConnectome(state, layerName);
      if (skeletonTracing == null) {
        return state;
      }

      const treesAndmaxNodeId = deleteConnectomeTrees(skeletonTracing, treeIds);
      if (treesAndmaxNodeId == null) {
        return state;
      }
      const [trees, newMaxNodeId] = treesAndmaxNodeId;
      return update(state, {
        localSegmentationData: {
          [layerName]: {
            connectomeData: {
              skeleton: {
                trees: {
                  $set: trees,
                },
                cachedMaxNodeId: {
                  $set: newMaxNodeId,
                },
              },
            },
          },
        },
      });
    }

    case "SET_CONNECTOME_TREES_VISIBILITY": {
      const { treeIds, isVisible, layerName } = action;
      const skeletonTracing = getSkeletonTracingForConnectome(state, layerName);
      if (skeletonTracing == null) {
        return state;
      }
      return setConnectomeTreesVisibilityReducer(state, layerName, treeIds, isVisible);
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

      if (availableConnectomeFiles == null) {
        // Connectome files have not been fetched yet, temporarily save the connectome file name
        // so it can be activated once the files have been fetched
        return updateKey3(state, "localSegmentationData", layerName, "connectomeData", {
          pendingConnectomeFileName: connectomeFileName,
        });
      }

      const connectomeFile = availableConnectomeFiles.find(
        (el) => el.connectomeFileName === connectomeFileName,
      );
      return updateKey3(state, "localSegmentationData", layerName, "connectomeData", {
        currentConnectomeFile: connectomeFile,
        pendingConnectomeFileName: null,
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
