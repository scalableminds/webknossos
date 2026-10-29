import update from "immutability-helper";
import DiffableMap from "libs/diffable_map";
import {
  getAgglomerateDiffKey,
  getAgglomerateDiffOverlay,
  getAgglomerateKey,
} from "viewer/model/accessors/agglomerate_diff_accessor";
import type { Action } from "viewer/model/actions/actions";
import {
  addTreesAndGroups,
  createMutableTreeMapFromTreeArray,
} from "viewer/model/reducers/skeletontracing_reducer_helpers";
import type { AgglomerateDiffOverlay, WebknossosState } from "viewer/store";

// The server names the trees of added and removed edges like this
const ADDED_EDGES_TREE_NAME = "added edges";

function updateOverlay(
  state: WebknossosState,
  overlayUpdate: Partial<AgglomerateDiffOverlay>,
): WebknossosState {
  return update(state, {
    localSkeletonState: { agglomerateDiffOverlay: { $merge: overlayUpdate } },
  });
}

function AgglomerateDiffReducer(state: WebknossosState, action: Action): WebknossosState {
  switch (action.type) {
    case "START_LOADING_AGGLOMERATE_DIFF": {
      const overlay = getAgglomerateDiffOverlay(state);
      const key = getAgglomerateDiffKey(action.descriptor);
      if (overlay.diffs[key] != null) return state;
      return updateOverlay(state, {
        diffs: {
          ...overlay.diffs,
          [key]: {
            ...action.descriptor,
            status: "loading",
            referenceAgglomerateId: null,
            treeIds: [],
            addedEdgeCount: 0,
            removedEdgeCount: 0,
          },
        },
      });
    }

    case "FINISH_LOADING_AGGLOMERATE_DIFF": {
      const overlay = getAgglomerateDiffOverlay(state);
      const key = getAgglomerateDiffKey(action.descriptor);
      const diff = overlay.diffs[key];
      // The diff might have been removed in the meantime
      if (diff == null || diff.status !== "loading") return state;
      if (action.diff == null) {
        return updateOverlay(state, {
          diffs: { ...overlay.diffs, [key]: { ...diff, status: "failed" } },
        });
      }

      const { skeleton } = overlay;
      const trees = createMutableTreeMapFromTreeArray(
        action.diff.trees.map((tree) => ({ ...tree, isVisible: overlay.isVisible })),
      );
      const treesAndGroups = addTreesAndGroups(skeleton, trees, []);
      if (treesAndGroups == null) return state;
      const [newTrees, _treeGroups, newMaxNodeId] = treesAndGroups;

      let addedEdgeCount = 0;
      let removedEdgeCount = 0;
      for (const tree of newTrees.values()) {
        if (tree.name === ADDED_EDGES_TREE_NAME) {
          addedEdgeCount += tree.edges.size();
        } else {
          removedEdgeCount += tree.edges.size();
        }
      }

      const { layerName, mappingName, agglomerateId } = action.descriptor;
      return updateOverlay(state, {
        diffs: {
          ...overlay.diffs,
          [key]: {
            ...diff,
            status: "loaded",
            referenceAgglomerateId: action.diff.referenceAgglomerateId,
            treeIds: newTrees.keys().toArray(),
            addedEdgeCount,
            removedEdgeCount,
          },
        },
        segmentIdByAgglomerate: {
          ...overlay.segmentIdByAgglomerate,
          [getAgglomerateKey(layerName, mappingName, agglomerateId)]: action.diff.segmentId,
        },
        skeleton: {
          ...skeleton,
          trees: DiffableMap.merge(skeleton.trees, newTrees),
          cachedMaxNodeId: newMaxNodeId,
        },
      });
    }

    case "REMOVE_AGGLOMERATE_DIFFS": {
      const overlay = getAgglomerateDiffOverlay(state);
      const keysToRemove = new Set(action.keys);
      let trees = overlay.skeleton.trees;
      for (const key of keysToRemove) {
        for (const treeId of overlay.diffs[key]?.treeIds ?? []) {
          trees = trees.delete(treeId);
        }
      }
      return updateOverlay(state, {
        diffs: Object.fromEntries(
          Object.entries(overlay.diffs).filter(([key]) => !keysToRemove.has(key)),
        ),
        // cachedMaxNodeId is kept, as it only needs to be an upper bound for new node ids
        skeleton: { ...overlay.skeleton, trees },
      });
    }

    case "SET_AGGLOMERATE_DIFFS_VISIBILITY": {
      const overlay = getAgglomerateDiffOverlay(state);
      const trees = overlay.skeleton.trees.clone();
      for (const tree of overlay.skeleton.trees.values()) {
        trees.mutableSet(tree.treeId, { ...tree, isVisible: action.isVisible });
      }
      return updateOverlay(state, {
        isVisible: action.isVisible,
        skeleton: { ...overlay.skeleton, trees },
      });
    }

    default:
      return state;
  }
}

export default AgglomerateDiffReducer;
