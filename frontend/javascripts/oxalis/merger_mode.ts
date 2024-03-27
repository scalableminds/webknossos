import _ from "lodash";
import type {
  DeleteNodeUpdateAction,
  NodeWithTreeId,
  UpdateActionNode,
} from "oxalis/model/sagas/update_actions";
import type { TreeMap, SkeletonTracing, OxalisState, StoreType } from "oxalis/store";
import type { Vector3 } from "oxalis/constants";
import { cachedDiffTrees } from "oxalis/model/sagas/skeletontracing_saga";
import {
  getInverseSegmentationTransformer,
  getVisibleSegmentationLayer,
} from "oxalis/model/accessors/dataset_accessor";
import {
  getNodePosition,
  getSkeletonTracing,
  transformNodePosition,
} from "oxalis/model/accessors/skeletontracing_accessor";
import Store from "oxalis/throttled_store";
import { api } from "oxalis/singletons";
import messages from "messages";
import { UnregisterHandler } from "oxalis/api/api_latest";
import { Action } from "oxalis/model/actions/actions";
import { CreateNodeAction } from "./model/actions/skeletontracing_actions";
import { type AdditionalCoordinate } from "types/api_flow_types";

type MergerModeState = {
  treeIdToRepresentativeSegmentId: Record<number, number | null | undefined>;
  idMapping: Map<number, number>;
  nodesPerSegment: Record<number, number>;
  nodes: Array<NodeWithTreeId>;
  // A properly initialized merger mode should always
  // have a segmentationLayerName. However, some edge cases
  // become easier when we handle the null case, anyway.
  // In theory, the UI should not allow to enable the merger mode
  // without a visible segmentation layer.
  segmentationLayerName: string | null | undefined;
  nodeSegmentMap: Record<string, any>;
  prevTracing: SkeletonTracing;
};
const unregisterKeyHandlers: UnregisterHandler[] = [];
const unsubscribeFunctions: Array<() => void> = [];
let isCodeActive = false;

function mapSegmentToRepresentative(
  segId: number,
  treeId: number,
  mergerModeState: MergerModeState,
) {
  const representative = getRepresentativeForTree(treeId, segId, mergerModeState);
  mergerModeState.idMapping.set(segId, representative);
}

function getRepresentativeForTree(treeId: number, segId: number, mergerModeState: MergerModeState) {
  const { treeIdToRepresentativeSegmentId } = mergerModeState;
  let representative = treeIdToRepresentativeSegmentId[treeId];

  // Use the passed segment id as a representative, if the tree was never seen before
  if (representative == null) {
    representative = segId;
    treeIdToRepresentativeSegmentId[treeId] = representative;
  }

  return representative;
}

function deleteIdMappingOfSegment(segId: number, treeId: number, mergerModeState: MergerModeState) {
  // Remove segment from color mapping
  mergerModeState.idMapping.delete(segId);
  delete mergerModeState.treeIdToRepresentativeSegmentId[treeId];
}

/* This function is used to increment the reference count /
   number of nodes mapped to the given segment */
function increaseNodesOfSegment(segementId: number, mergerModeState: MergerModeState) {
  const { nodesPerSegment } = mergerModeState;
  const currentValue = nodesPerSegment[segementId];

  if (currentValue == null) {
    nodesPerSegment[segementId] = 1;
  } else {
    nodesPerSegment[segementId] = currentValue + 1;
  }

  return nodesPerSegment[segementId];
}

/* This function is used to decrement the reference count /
   number of nodes mapped to the given segment. */
function decreaseNodesOfSegment(segementId: number, mergerModeState: MergerModeState): number {
  const { nodesPerSegment } = mergerModeState;
  const currentValue = nodesPerSegment[segementId];
  nodesPerSegment[segementId] = currentValue - 1;
  return nodesPerSegment[segementId];
}

function getAllNodesWithTreeId(): Array<NodeWithTreeId> {
  const trees: TreeMap = api.tracing.getAllTrees();
  const nodes: Array<NodeWithTreeId> = [];
  // Create an array of all nodes, but with the additional treeId Property
  Object.keys(trees).forEach((treeId) => {
    const currentTreeId = parseInt(treeId);
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

  const segmentId = await getSegmentId(
    store.getState(),
    segmentationLayerName,
    untransformedPosition,
    additionalCoordinates,
  );

  // If there is no segment id, the node was set outside of all segments.
  // Drop the node creation action in that case.
  if (!segmentId) {
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
  const { idMapping, segmentationLayerName, nodeSegmentMap } = mergerModeState;

  if (segmentationLayerName == null) {
    return;
  }

  const segmentId = await getSegmentId(
    Store.getState(),
    segmentationLayerName,
    untransformedPosition,
    additionalCoordinates,
  );

  // It can still happen that there are createNode diffing actions for nodes which
  // are placed outside of a segment, for example when merging trees that were created
  // outside of merger mode. Ignore those nodes.
  if (!segmentId) {
    return;
  }

  // Set segment id
  nodeSegmentMap[nodeId] = segmentId;
  // Count references
  increaseNodesOfSegment(segmentId, mergerModeState);
  mapSegmentToRepresentative(segmentId, treeId, mergerModeState);

  if (updateMapping) {
    // Update mapping
    api.data.setMapping(segmentationLayerName, idMapping);
  }
}

async function getSegmentId(
  state: OxalisState,
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

  const segmentId = mergerModeState.nodeSegmentMap[nodeWithTreeId.nodeId];
  const numberOfNodesMappedToSegment = decreaseNodesOfSegment(segmentId, mergerModeState);

  if (numberOfNodesMappedToSegment === 0) {
    // Reset color of all segments that were mapped to this tree
    deleteIdMappingOfSegment(segmentId, nodeWithTreeId.treeId, mergerModeState);

    if (updateMapping) {
      api.data.setMapping(segmentationLayerName, mergerModeState.idMapping);
    }
  }
}

async function onUpdateNode(mergerModeState: MergerModeState, node: UpdateActionNode) {
  const { position: untransformedPosition, id, treeId } = node;
  const { segmentationLayerName, nodeSegmentMap } = mergerModeState;

  if (segmentationLayerName == null) {
    return;
  }

  const state = Store.getState();

  const segmentId = await getSegmentId(
    state,
    segmentationLayerName,
    untransformedPosition,
    state.flycam.additionalCoordinates,
  );

  if (nodeSegmentMap[id] !== segmentId) {
    // If the segment of the node changed, it is like the node got deleted and a copy got created somewhere else.
    // Thus we use the onNodeDelete and onNodeCreate method to update the mapping.
    if (nodeSegmentMap[id] != null) {
      await onDeleteNode(mergerModeState, { nodeId: id, treeId }, false);
    }

    if (segmentId != null && segmentId > 0) {
      await onCreateNode(
        mergerModeState,
        id,
        treeId,
        untransformedPosition,
        node.additionalCoordinates,
        false,
      );
    } else if (nodeSegmentMap[id] != null) {
      // The node is not inside a segment anymore. Thus we delete it from the nodeSegmentMap.
      delete nodeSegmentMap[id];
    }

    api.data.setMapping(segmentationLayerName, mergerModeState.idMapping);
  }
}

function updateState(mergerModeState: MergerModeState, skeletonTracing: SkeletonTracing) {
  const diff = cachedDiffTrees(mergerModeState.prevTracing.trees, skeletonTracing.trees);

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
  // eslint-disable-next-line @typescript-eslint/default-param-last
  index = 0,
  mergerModeState: MergerModeState,
  onProgressUpdate: (arg0: number) => void,
) {
  const { nodes, segmentationLayerName, nodeSegmentMap, idMapping } = mergerModeState;
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

    const segmentId = await api.data.getDataValue(segmentationLayerName, segmentPosition);

    if (segmentId != null && segmentId > 0) {
      // Store the segment id
      nodeSegmentMap[node.id] = segmentId;
      // Add to agglomerate
      increaseNodesOfSegment(segmentId, mergerModeState);
      mapSegmentToRepresentative(segmentId, treeId, mergerModeState);
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
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(nodesMappedPromises);
  }

  api.data.setMapping(segmentationLayerName, idMapping);
}

function resetState(mergerModeState: Partial<MergerModeState> = {}) {
  const state = Store.getState();
  const visibleLayer = getVisibleSegmentationLayer(state);
  const segmentationLayerName = visibleLayer != null ? visibleLayer.name : null;
  const defaults: MergerModeState = {
    treeIdToRepresentativeSegmentId: {},
    idMapping: new Map(),
    nodesPerSegment: {},
    nodes: getAllNodesWithTreeId(),
    segmentationLayerName,
    nodeSegmentMap: {},
    prevTracing: getSkeletonTracing(state.tracing).get(),
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
      getSkeletonTracing(state.tracing).map((skeletonTracing) => {
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
      });
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
