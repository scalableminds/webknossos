import update from "immutability-helper";
import DiffableMap from "libs/diffable_map";
import Constants, { TreeTypeEnum, type Vector3 } from "viewer/constants";
import {
  getAgglomerateDiffKey,
  getAgglomerateDiffOverlay,
  isDiffOfPosition,
} from "viewer/model/accessors/agglomerate_diff_accessor";
import type { Action } from "viewer/model/actions/actions";
import EdgeCollection from "viewer/model/edge_collection";
import type { ServerAgglomerateGraphDiff } from "viewer/model/helpers/proto_helpers";
import { addTreesAndGroups } from "viewer/model/reducers/skeletontracing_reducer_helpers";
import {
  type MutableNode,
  MutableTreeMap,
  type Tree,
  type TreeMap,
} from "viewer/model/types/tree_types";
import type { AgglomerateDiff, AgglomerateDiffOverlay, WebknossosState } from "viewer/store";

// Pure green and orange are the two colors which are perceptually farthest away from the
// palette that webknossos uses for tree colors (e.g., of the agglomerate skeletons).
const ADDED_EDGES_COLOR: Vector3 = [0, 1, 0];
const REMOVED_EDGES_COLOR: Vector3 = [1, 136 / 255, 0];

/*
 * Creates one tree for the added and one for the removed edges of a diff (if there are any).
 * In contrast to annotation trees, these trees don't need to be connected, as they are only
 * rendered. Note that code which relies on connected trees must not be used for them.
 */
function createDiffTrees(diff: ServerAgglomerateGraphDiff, isVisible: boolean): MutableTreeMap {
  const trees = new MutableTreeMap();
  const timestamp = Date.now();
  let nextNodeId = Constants.MIN_NODE_ID;
  const treeSpecs = [
    { name: "Added edges", color: ADDED_EDGES_COLOR, endpointIndices: diff.addedEdges },
    { name: "Removed edges", color: REMOVED_EDGES_COLOR, endpointIndices: diff.removedEdges },
  ];

  for (const { name, color, endpointIndices } of treeSpecs) {
    if (endpointIndices.length === 0) continue;
    const nodeIdByEndpointIndex = new Map<number, number>();
    const nodes: Array<[number, MutableNode]> = [];
    const getNodeId = (endpointIndex: number): number => {
      const existingNodeId = nodeIdByEndpointIndex.get(endpointIndex);
      if (existingNodeId != null) return existingNodeId;
      const nodeId = nextNodeId++;
      nodeIdByEndpointIndex.set(endpointIndex, nodeId);
      const positionOffset = 3 * endpointIndex;
      nodes.push([
        nodeId,
        {
          id: nodeId,
          untransformedPosition: [
            diff.positions[positionOffset],
            diff.positions[positionOffset + 1],
            diff.positions[positionOffset + 2],
          ],
          additionalCoordinates: null,
          rotation: [0, 0, 0],
          bitDepth: 8,
          viewport: 0,
          mag: 0,
          radius: Constants.DEFAULT_NODE_RADIUS,
          timestamp,
          interpolation: false,
        },
      ]);
      return nodeId;
    };

    const edges = [];
    for (let idx = 0; idx < endpointIndices.length; idx += 2) {
      edges.push({
        source: getNodeId(endpointIndices[idx]),
        target: getNodeId(endpointIndices[idx + 1]),
      });
    }
    const treeId = Constants.MIN_TREE_ID + trees.size();
    trees.mutableSet(treeId, {
      treeId,
      name,
      color,
      nodes: new DiffableMap(nodes),
      edges: EdgeCollection.loadFromArray(edges),
      timestamp,
      comments: [],
      branchPoints: [],
      isVisible,
      groupId: null,
      type: TreeTypeEnum.DEFAULT,
      edgesAreVisible: true,
      metadata: [],
    });
  }
  return trees;
}

function updateOverlay(
  state: WebknossosState,
  overlayUpdate: Partial<AgglomerateDiffOverlay>,
): WebknossosState {
  return update(state, {
    localSkeletonState: { agglomerateDiffOverlay: { $merge: overlayUpdate } },
  });
}

// A diff is shown if diffs are shown at all and its agglomerate skeleton exists and is visible
function isDiffVisible(overlay: AgglomerateDiffOverlay, diff: AgglomerateDiff): boolean {
  return overlay.isVisible && diff.sourceTreeId != null && diff.isSourceTreeVisible;
}

// Sets the visibility of the trees of the given diffs according to isDiffVisible
function updateTreeVisibility(
  trees: TreeMap,
  overlay: AgglomerateDiffOverlay,
  diffs: Iterable<AgglomerateDiff>,
): TreeMap {
  let mutableTrees: DiffableMap<number, Tree> | null = null;
  for (const diff of diffs) {
    const isVisible = isDiffVisible(overlay, diff);
    for (const treeId of diff.treeIds) {
      const tree = trees.getNullable(treeId);
      if (tree == null || tree.isVisible === isVisible) continue;
      mutableTrees ??= trees.clone();
      mutableTrees.mutableSet(treeId, { ...tree, isVisible });
    }
  }
  return mutableTrees ?? trees;
}

function AgglomerateDiffReducer(state: WebknossosState, action: Action): WebknossosState {
  switch (action.type) {
    case "REQUEST_AGGLOMERATE_DIFF": {
      const overlay = getAgglomerateDiffOverlay(state);
      const key = getAgglomerateDiffKey(action.descriptor);
      if (overlay.diffs[key] != null) return state;
      return updateOverlay(state, {
        diffs: {
          ...overlay.diffs,
          [key]: {
            ...action.descriptor,
            status: "loading",
            positionInLayer: action.positionInLayer,
            awaitsAgglomerateSkeleton: action.awaitsAgglomerateSkeleton,
            // Set by the agglomerate_diff_saga once the agglomerate skeleton exists
            sourceTreeId: null,
            isSourceTreeVisible: true,
            referenceAgglomerateId: null,
            treeIds: [],
            addedEdgeCount: 0,
            removedEdgeCount: 0,
            errorMessage: null,
          },
        },
      });
    }

    case "FINISH_LOADING_AGGLOMERATE_DIFF": {
      const overlay = getAgglomerateDiffOverlay(state);
      const key = getAgglomerateDiffKey(action.descriptor);
      const diff = overlay.diffs[key];
      // The diff might have been removed or requested for another position in the meantime
      if (
        diff == null ||
        diff.status !== "loading" ||
        !isDiffOfPosition(diff, action.positionInLayer)
      ) {
        return state;
      }

      const { skeleton } = overlay;
      const trees = createDiffTrees(action.diff, isDiffVisible(overlay, diff));
      const treesAndGroups = addTreesAndGroups(skeleton, trees, []);
      if (treesAndGroups == null) return state;
      const [newTrees, _treeGroups, newMaxNodeId] = treesAndGroups;

      return updateOverlay(state, {
        diffs: {
          ...overlay.diffs,
          [key]: {
            ...diff,
            status: "loaded",
            referenceAgglomerateId: action.diff.referenceAgglomerateId,
            treeIds: newTrees.keys().toArray(),
            addedEdgeCount: action.diff.addedEdges.length / 2,
            removedEdgeCount: action.diff.removedEdges.length / 2,
          },
        },
        skeleton: {
          ...skeleton,
          trees: DiffableMap.merge(skeleton.trees, newTrees),
          cachedMaxNodeId: newMaxNodeId,
        },
      });
    }

    case "FAIL_LOADING_AGGLOMERATE_DIFF": {
      const overlay = getAgglomerateDiffOverlay(state);
      const key = getAgglomerateDiffKey(action.descriptor);
      const diff = overlay.diffs[key];
      if (
        diff == null ||
        diff.status !== "loading" ||
        !isDiffOfPosition(diff, action.positionInLayer)
      ) {
        return state;
      }
      return updateOverlay(state, {
        diffs: {
          ...overlay.diffs,
          [key]: { ...diff, status: "failed", errorMessage: action.errorMessage },
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
      const newOverlay = { ...overlay, isVisible: action.isVisible };
      const trees = updateTreeVisibility(
        overlay.skeleton.trees,
        newOverlay,
        Object.values(overlay.diffs),
      );
      return updateOverlay(state, {
        isVisible: action.isVisible,
        skeleton: { ...overlay.skeleton, trees },
      });
    }

    case "SYNC_AGGLOMERATE_DIFFS_WITH_SOURCE_TREES": {
      const overlay = getAgglomerateDiffOverlay(state);
      const diffs = { ...overlay.diffs };
      const changedDiffs = [];
      for (const [key, sourceTree] of Object.entries(action.sourceTreeByKey)) {
        const diff = diffs[key];
        if (diff == null) continue;
        diffs[key] = {
          ...diff,
          sourceTreeId: sourceTree.treeId,
          isSourceTreeVisible: sourceTree.isVisible,
          awaitsAgglomerateSkeleton: false,
        };
        changedDiffs.push(diffs[key]);
      }
      if (changedDiffs.length === 0) return state;
      const trees = updateTreeVisibility(overlay.skeleton.trees, overlay, changedDiffs);
      return updateOverlay(state, { diffs, skeleton: { ...overlay.skeleton, trees } });
    }

    default:
      return state;
  }
}

export default AgglomerateDiffReducer;
