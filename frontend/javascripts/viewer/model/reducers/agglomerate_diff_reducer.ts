import update from "immutability-helper";
import DiffableMap from "libs/diffable_map";
import Constants, { TreeTypeEnum, type Vector3 } from "viewer/constants";
import {
  getAgglomerateDiffKey,
  getAgglomerateDiffOverlay,
  getAgglomerateKey,
} from "viewer/model/accessors/agglomerate_diff_accessor";
import type { Action } from "viewer/model/actions/actions";
import type { LoadedAgglomerateDiff } from "viewer/model/actions/agglomerate_diff_actions";
import EdgeCollection from "viewer/model/edge_collection";
import { addTreesAndGroups } from "viewer/model/reducers/skeletontracing_reducer_helpers";
import { type MutableNode, MutableTreeMap } from "viewer/model/types/tree_types";
import type { AgglomerateDiffOverlay, WebknossosState } from "viewer/store";

// Pure green and orange are the two colors which are perceptually farthest away from the
// palette that webknossos uses for tree colors (e.g., of the agglomerate skeletons).
const ADDED_EDGES_COLOR: Vector3 = [0, 1, 0];
const REMOVED_EDGES_COLOR: Vector3 = [1, 136 / 255, 0];

/*
 * Creates one tree for the added and one for the removed edges of a diff (if there are any).
 * In contrast to annotation trees, these trees don't need to be connected, as they are only
 * rendered. Note that code which relies on connected trees must not be used for them.
 */
function createDiffTrees(diff: LoadedAgglomerateDiff, isVisible: boolean): MutableTreeMap {
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
      const trees = createDiffTrees(action.diff, overlay.isVisible);
      const treesAndGroups = addTreesAndGroups(skeleton, trees, []);
      if (treesAndGroups == null) return state;
      const [newTrees, _treeGroups, newMaxNodeId] = treesAndGroups;

      const { layerName, mappingName, agglomerateId } = action.descriptor;
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
