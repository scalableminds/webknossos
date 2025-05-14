import _ from "lodash";
import messages from "messages";
import type { AdditionalCoordinate } from "types/api_types";
import type { UnregisterHandler } from "viewer/api/api_latest";
import type { Vector3 } from "viewer/constants";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { getInverseSegmentationTransformer } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import {
  enforceSkeletonTracing,
  getNodePosition,
  getSkeletonTracing,
  transformNodePosition,
} from "viewer/model/accessors/skeletontracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import { cachedDiffTrees } from "viewer/model/sagas/skeletontracing_saga";
import type {
  DeleteNodeUpdateAction,
  NodeWithTreeId,
  UpdateActionNode,
} from "viewer/model/sagas/update_actions";
import { api } from "viewer/singletons";
import type { SkeletonTracing, StoreType, TreeMap, WebknossosState } from "viewer/store";
import Store from "viewer/throttled_store";
import type { CreateNodeAction } from "./model/actions/skeletontracing_actions";

type MergerModeState = {
  // Representative Segment Id is a mapped id.
  treeIdToRepresentativeSegmentId: Record<number, number | null | undefined>;
  idMapping: Map<number, number>;

  // Unmapped Segment Id -> Count
  nodesPerUnmappedSegment: Record<number, number>;
  nodes: Array<NodeWithTreeId>;

  // A properly initialized merger mode should always
  // have a segmentationLayerName. However, some edge cases
  // become easier when we handle the null case, anyway.
  // In theory, the UI should not allow to enable the merger mode
  // without a visible segmentation layer.
  segmentationLayerName: string | null | undefined;

  // Node Id -> Unmapped Segment Id
  nodeToUnmappedSegmentMap: Record<string, number>;
  prevTracing: SkeletonTracing;
};
const unregisterKeyHandlers: UnregisterHandler[] = [];
const unsubscribeFunctions: Array<() => void> = [];
let isCodeActive = false;

function mapSegmentToRepresentative(
  unmappedSegmentId: number,
  treeId: number,
  mergerModeState: MergerModeState,
) {
  const representative = getRepresentativeForTree(treeId, unmappedSegmentId, mergerModeState);
  mergerModeState.idMapping.set(unmappedSegmentId, representative);
}

function getRepresentativeForTree(
  treeId: number,
  unmappedSegmentId: number,
  mergerModeState: MergerModeState,
) {
  const { treeIdToRepresentativeSegmentId } = mergerModeState;
  let representative = treeIdToRepresentativeSegmentId[treeId];

  // Use the passed segment id as a representative, if the tree was never seen before
  if (representative == null) {
    representative = unmappedSegmentId;
    treeIdToRepresentativeSegmentId[treeId] = representative;
  }

  return representative;
}

function removeUnmappedSegmentIdFromMapping(
  unmappedSegmentId: number,
  treeId: number,
  mergerModeState: MergerModeState,
) {
  if (mergerModeState.idMapping.get(unmappedSegmentId) === unmappedSegmentId) {
    // The representative was removed from the mapping. Delete it.
    delete mergerModeState.treeIdToRepresentativeSegmentId[treeId];

    // Relabel ids that were mapped to the old representative (and find
    // a new one).
    let newRepresentative;
    for (const [key, value] of mergerModeState.idMapping) {
      if (key === unmappedSegmentId) {
        // This is the value that is about to be removed.
        continue;
      }
      if (value === unmappedSegmentId) {
        if (newRepresentative == null) {
          newRepresentative = key;
        }
        mergerModeState.idMapping.set(key, newRepresentative);
      }
    }

    if (newRepresentative != null) {
      mergerModeState.treeIdToRepresentativeSegmentId[treeId] = newRepresentative;
    }
  }
  // Remove segment from color mapping
  mergerModeState.idMapping.delete(unmappedSegmentId);
}

/* This function is used to increment the reference count /
   number of nodes mapped to the given segment */
function increaseNodesOfUnmappedSegment(
  unmappedSegmentId: number,
  mergerModeState: MergerModeState,
) {
  const { nodesPerUnmappedSegment } = mergerModeState;
  const currentValue = nodesPerUnmappedSegment[unmappedSegmentId];

  if (currentValue == null) {
    nodesPerUnmappedSegment[unmappedSegmentId] = 1;
  } else {
    nodesPerUnmappedSegment[unmappedSegmentId] = currentValue + 1;
  }

  return nodesPerUnmappedSegment[unmappedSegmentId];
}

/* This function is used to decrement the reference count /
   number of nodes mapped to the given segment. */
function decreaseNodesOfUnmappedSegment(
  unmappedSegmentId: number,
  mergerModeState: MergerModeState,
): number {
  const { nodesPerUnmappedSegment } = mergerModeState;
  const currentValue = nodesPerUnmappedSegment[unmappedSegmentId];
  nodesPerUnmappedSegment[unmappedSegmentId] = currentValue - 1;
  return nodesPerUnmappedSegment[unmappedSegmentId];
}

function getAllNodesWithTreeId(): Array<NodeWithTreeId> {
  const trees: TreeMap = api.tracing.getAllTrees();
  const nodes: Array<NodeWithTreeId> = [];
  // Create an array of all nodes, but with the additional treeId Property
  Object.keys(trees).forEach((treeId) => {
    const currentTreeId = Number.parseInt(treeId);
    const currentTree = trees[currentTreeId];

    for (const node of currentTree.nodes.values()) {
      const nodeWithTreeId: NodeWithTreeId = Object.assign({}, node, {
        treeId: currentTreeId,
      });
      nodes.push(nodeWithTreeId);
    }
  });

  return nodes;
}

// Do not create nodes if they are set outside of segments.
async function createNodeOverwrite(
  store: StoreType,
  call: (action: Action) => void,
  action: CreateNodeAction,
  mergerModeState: MergerModeState,
): Promise<Action> {
  const { segmentationLayerName } = mergerModeState;

  if (!segmentationLayerName) {
    return action;
  }
  const { position: untransformedPosition, additionalCoordinates } = action;

  const unmappedSegmentId = await getUnmappedSegmentId(
    store.getState(),
    segmentationLayerName,
    untransformedPosition,
    additionalCoordinates,
  );

  // If there is no segment id, the node was set outside of all segments.
  // Drop the node creation action in that case.
  if (!unmappedSegmentId) {
    api.utils.showToast("warning", messages["tracing.merger_mode_node_outside_segment"]);
  } else {
    call(action);

    // Center the created cell manually, as somehow without this call the previous node would be centered.
    if (Store.getState().userConfiguration.centerNewNode) {
      api.tracing.centerActiveNode();
    }
  }
  return action;
}

/* React to added nodes. Look up the segment id at the node position and
  display it in the same color as the rest of the aggregate. */
async function onCreateNode(
  mergerModeState: MergerModeState,
  nodeId: number,
  treeId: number,
  untransformedPosition: Vector3,
  additionalCoordinates: AdditionalCoordinate[] | null,
  updateMapping: boolean = true,
) {
  const { idMapping, segmentationLayerName, nodeToUnmappedSegmentMap } = mergerModeState;

  if (segmentationLayerName == null) {
    return;
  }

  const unmappedSegmentId = await getUnmappedSegmentId(
    Store.getState(),
    segmentationLayerName,
    untransformedPosition,
    additionalCoordinates,
  );

  // It can still happen that there are createNode diffing actions for nodes which
  // are placed outside of a segment, for example when merging trees that were created
  // outside of merger mode. Ignore those nodes.
  if (!unmappedSegmentId) {
    return;
  }

  nodeToUnmappedSegmentMap[nodeId] = unmappedSegmentId;

  // Count references
  increaseNodesOfUnmappedSegment(unmappedSegmentId, mergerModeState);
  mapSegmentToRepresentative(unmappedSegmentId, treeId, mergerModeState);

  if (updateMapping) {
    // Update mapping
    api.data.setMapping(segmentationLayerName, idMapping, { isMergerModeMapping: true });
  }
}

async function getUnmappedSegmentId(
  state: WebknossosState,
  segmentationLayerName: string,
  untransformedPosition: Vector3,
  additionalCoordinates: AdditionalCoordinate[] | null,
) {
  // Calculate where the node is actually rendered.
  const transformedNodePosition = transformNodePosition(untransformedPosition, state);

  // Apply the inverse of the segmentation transform to know where to look up
  // the voxel value.
  const inverseSegmentationTransform = getInverseSegmentationTransformer(
    state,
    segmentationLayerName,
  );
  const segmentPosition = inverseSegmentationTransform(transformedNodePosition);

  const segmentId = await api.data.getDataValue(
    segmentationLayerName,
    segmentPosition,
    null,
    additionalCoordinates,
  );
  return segmentId;
}

/* This function decreases the number of nodes associated with the segment the passed node belongs to.
 * If the count reaches 0, the segment is removed from the mapping and the mapping is updated.
 */
async function onDeleteNode(
  mergerModeState: MergerModeState,
  nodeWithTreeId: DeleteNodeUpdateAction["value"],
  updateMapping: boolean = true,
) {
  const { segmentationLayerName } = mergerModeState;

  if (segmentationLayerName == null) {
    return;
  }

  const unmappedSegmentId = mergerModeState.nodeToUnmappedSegmentMap[nodeWithTreeId.nodeId];
  const numberOfNodesInUnmappedSegment = decreaseNodesOfUnmappedSegment(
    unmappedSegmentId,
    mergerModeState,
  );

  if (numberOfNodesInUnmappedSegment === 0) {
    // Reset color of the unmapped segment that was mapped to this tree
    removeUnmappedSegmentIdFromMapping(unmappedSegmentId, nodeWithTreeId.treeId, mergerModeState);

    if (updateMapping) {
      api.data.setMapping(segmentationLayerName, mergerModeState.idMapping, {
        isMergerModeMapping: true,
      });
    }
  }
}

async function onUpdateNode(mergerModeState: MergerModeState, node: UpdateActionNode) {
  const { position: untransformedPosition, id, treeId } = node;
  const { segmentationLayerName, nodeToUnmappedSegmentMap } = mergerModeState;

  if (segmentationLayerName == null) {
    return;
  }

  const state = Store.getState();

  const unmappedSegmentId = await getUnmappedSegmentId(
    state,
    segmentationLayerName,
    untransformedPosition,
    state.flycam.additionalCoordinates,
  );

  if (nodeToUnmappedSegmentMap[id] !== unmappedSegmentId) {
    // If the segment of the node changed, it is like the node got deleted and a copy got created somewhere else.
    // Thus we use the onNodeDelete and onNodeCreate method to update the mapping.
    if (nodeToUnmappedSegmentMap[id] != null) {
      await onDeleteNode(
        mergerModeState,
        { nodeId: id, treeId, actionTracingId: mergerModeState.prevTracing.tracingId },
        false,
      );
    }

    if (unmappedSegmentId != null && unmappedSegmentId > 0) {
      await onCreateNode(
        mergerModeState,
        id,
        treeId,
        untransformedPosition,
        node.additionalCoordinates,
        false,
      );
    } else if (nodeToUnmappedSegmentMap[id] != null) {
      // The node is not inside a segment anymore. Thus we delete it from the nodeToUnmappedSegmentMap.
      delete nodeToUnmappedSegmentMap[id];
    }

    api.data.setMapping(segmentationLayerName, mergerModeState.idMapping, {
      isMergerModeMapping: true,
    });
  }
}

function updateState(mergerModeState: MergerModeState, skeletonTracing: SkeletonTracing) {
  const diff = cachedDiffTrees(
    skeletonTracing.tracingId,
    mergerModeState.prevTracing.trees,
    skeletonTracing.trees,
  );

  for (const action of diff) {
    switch (action.name) {
      case "createNode": {
        const { treeId, id: nodeId, position: untransformedPosition } = action.value;
        onCreateNode(
          mergerModeState,
          nodeId,
          treeId,
          untransformedPosition,
          action.value.additionalCoordinates,
        );
        break;
      }

      case "deleteNode": {
        onDeleteNode(mergerModeState, action.value);
        break;
      }

      case "updateNode": {
        onUpdateNode(mergerModeState, action.value);
        break;
      }

      default:
        break;
    }
  }

  mergerModeState.prevTracing = skeletonTracing;
}

type WriteableDatasetLayerConfiguration = Record<
  string,
  {
    isDisabled: boolean;
  }
>;

// Changes the opacity of the segmentation layer
function changeOpacity(mergerModeState: MergerModeState) {
  const { segmentationLayerName } = mergerModeState;

  if (segmentationLayerName == null) {
    return;
  }

  const layerSettings = api.data.getConfiguration("layers");
  // Invert the visibility of the segmentation layer.
  const copyOfLayerSettings: WriteableDatasetLayerConfiguration = _.cloneDeep(layerSettings) as any;
  const isSegmentationDisabled = copyOfLayerSettings[segmentationLayerName].isDisabled;
  copyOfLayerSettings[segmentationLayerName].isDisabled = !isSegmentationDisabled;
  api.data.setConfiguration("layers", copyOfLayerSettings);
}

async function mergeSegmentsOfAlreadyExistingTrees(
  index = 0,
  mergerModeState: MergerModeState,
  onProgressUpdate: (arg0: number) => void,
) {
  const { nodes, segmentationLayerName, nodeToUnmappedSegmentMap, idMapping } = mergerModeState;
  const numbOfNodes = nodes.length;

  if (index >= numbOfNodes) {
    return;
  }

  if (segmentationLayerName == null) {
    return;
  }

  const [segMinVec, segMaxVec] = api.data.getBoundingBox(segmentationLayerName);

  const setSegmentationOfNode = async (node: NodeWithTreeId) => {
    const transformedNodePosition = getNodePosition(node, Store.getState());
    const { treeId } = node;

    // Apply the inverse of the segmentation transform to know where to look up
    // the voxel value.
    const state = Store.getState();
    const inverseSegmentationTransform = getInverseSegmentationTransformer(
      state,
      segmentationLayerName,
    );
    const segmentPosition = inverseSegmentationTransform(transformedNodePosition);

    // Skip nodes outside segmentation
    if (
      segmentPosition[0] < segMinVec[0] ||
      segmentPosition[1] < segMinVec[1] ||
      segmentPosition[2] < segMinVec[2] ||
      segmentPosition[0] >= segMaxVec[0] ||
      segmentPosition[1] >= segMaxVec[1] ||
      segmentPosition[2] >= segMaxVec[2]
    ) {
      // The node is not in bounds of the segmentation
      return;
    }

    const unmappedSegmentId = await api.data.getDataValue(segmentationLayerName, segmentPosition);

    if (unmappedSegmentId != null && unmappedSegmentId > 0) {
      // Store the segment id
      nodeToUnmappedSegmentMap[node.id] = unmappedSegmentId;
      // Add to agglomerate
      increaseNodesOfUnmappedSegment(unmappedSegmentId, mergerModeState);
      mapSegmentToRepresentative(unmappedSegmentId, treeId, mergerModeState);
    }
  };

  const BATCH_SIZE = 128;

  // Batch the segmentation lookup, otherwise there are too many bucket requests at once
  // and this step will never complete
  for (let cur = 0; cur < numbOfNodes; cur += BATCH_SIZE) {
    onProgressUpdate((cur / numbOfNodes) * 100);
    const nodesMappedPromises = nodes
      .slice(cur, cur + BATCH_SIZE)
      .map((node) => setSegmentationOfNode(node));

    await Promise.all(nodesMappedPromises);
  }

  api.data.setMapping(segmentationLayerName, idMapping, { isMergerModeMapping: true });
}

function resetState(mergerModeState: Partial<MergerModeState> = {}) {
  const state = Store.getState();
  const visibleLayer = getVisibleSegmentationLayer(state);
  const segmentationLayerName = visibleLayer != null ? visibleLayer.name : null;

  const defaults: MergerModeState = {
    treeIdToRepresentativeSegmentId: {},
    idMapping: new Map(),
    nodesPerUnmappedSegment: {},
    nodes: getAllNodesWithTreeId(),
    segmentationLayerName,
    nodeToUnmappedSegmentMap: {},
    prevTracing: enforceSkeletonTracing(state.annotation),
  };
  // Keep the object identity when resetting
  return Object.assign(mergerModeState, defaults);
}

export async function enableMergerMode(
  onProgressUpdate: (arg0: number) => void,
): Promise<string | null | undefined> {
  if (isCodeActive) {
    return null;
  }

  isCodeActive = true;
  // Create an object that stores the state of the merger mode.
  const mergerModeState: MergerModeState = resetState();
  // Register for tracing changes
  unsubscribeFunctions.push(
    Store.subscribe(() => {
      const state = Store.getState();
      const skeletonTracing = getSkeletonTracing(state.annotation);
      if (!skeletonTracing) {
        return;
      }
      const { segmentationLayerName } = mergerModeState;

      if (!segmentationLayerName) {
        return;
      }

      if (skeletonTracing.tracingId !== mergerModeState.prevTracing.tracingId) {
        // Correctly reset merger mode state in task hotswap
        resetState(mergerModeState);
        api.data.setMappingEnabled(false, segmentationLayerName);
      } else {
        updateState(mergerModeState, skeletonTracing);
      }
    }),
  );
  // Register for single CREATE_NODE actions to avoid setting nodes outside of segments
  unsubscribeFunctions.push(
    api.utils.registerOverwrite<StoreType, Action>("CREATE_NODE", (store, next, originalAction) =>
      createNodeOverwrite(store, next, originalAction as CreateNodeAction, mergerModeState),
    ),
  );
  // Register the additional key handler
  unregisterKeyHandlers.push(
    api.utils.registerKeyHandler("9", () => {
      changeOpacity(mergerModeState);
    }),
  );
  // wait for preprocessing the already existing trees before returning
  await mergeSegmentsOfAlreadyExistingTrees(0, mergerModeState, onProgressUpdate);
  return mergerModeState.segmentationLayerName;
}

export function disableMergerMode(segmentationLayerName: string | null | undefined) {
  if (!isCodeActive) {
    return;
  }

  isCodeActive = false;
  unsubscribeFunctions.forEach((unsubscribeFunction) => unsubscribeFunction());
  unregisterKeyHandlers.forEach((unregisterObject) => unregisterObject.unregister());

  // Disable the custom merger mode mapping
  if (segmentationLayerName != null) {
    api.data.setMappingEnabled(false, segmentationLayerName);
  }
}
