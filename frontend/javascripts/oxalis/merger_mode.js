// @flow
import { Modal } from "antd";
import type { Node, TreeMap, SkeletonTracing } from "oxalis/store";
import api from "oxalis/api/internal_api";
import _ from "lodash";
import type { Vector3 } from "oxalis/constants";
import { getSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import Store from "oxalis/throttled_store";
import { cachedDiffTrees } from "oxalis/model/sagas/skeletontracing_saga";

type NodeWithTreeId = Node & { treeId: number };

type MergerModeState = {
  treeColors: Object,
  colorMapping: Object,
  nodesPerSegment: Object,
  nodes: Array<NodeWithTreeId>,
  segmentationLayerName: string,
  nodeSegmentMap: Object,
  prevTracing: SkeletonTracing,
};

const unregisterKeyHandlers = [];
const unsubscribeFunctions = [];
let isCodeActive = false;

function mapSegmentColorToTree(segId: number, treeId: number, mergerModeState: MergerModeState) {
  // add segment to color mapping
  const color = getTreeColor(treeId, mergerModeState);
  mergerModeState.colorMapping[segId] = color;
}

function getTreeColor(treeId: number, mergerModeState: MergerModeState) {
  const { treeColors } = mergerModeState;
  let color = treeColors[treeId];
  // Generate a new color if tree was never seen before
  if (color === undefined) {
    color = Math.ceil(127 * Math.random());
    treeColors[treeId] = color;
  }
  return color;
}

function deleteColorMappingOfSegment(segId: number, mergerModeState: MergerModeState) {
  // Remove segment from color mapping
  delete mergerModeState.colorMapping[segId];
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
  const nodes = [];
  // Create an array of all nodes, but with the additional treeId Property
  Object.keys(trees).forEach(treeId => {
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

/* React to added nodes. Look up the segment id at the node position and
  display it in the same color as the rest of the aggregate. */
async function createNode(
  mergerModeState: MergerModeState,
  nodeId: number,
  treeId: number,
  position: Vector3,
) {
  const { colorMapping, segmentationLayerName, nodeSegmentMap } = mergerModeState;
  const segmentId = await api.data.getDataValue(segmentationLayerName, position);

  // If there is no segment id, the node was set too close to a border between segments.
  if (!segmentId) {
    api.utils.showToast(
      "warning",
      "You've set a node too close to grey. The node will be removed now.",
    );
    api.tracing.deleteNode(nodeId, treeId);
    return;
  }

  // Set segment id
  nodeSegmentMap[nodeId] = segmentId;
  // Count references
  increaseNodesOfSegment(segmentId, mergerModeState);
  mapSegmentColorToTree(segmentId, treeId, mergerModeState);

  // Update mapping
  api.data.setMapping(segmentationLayerName, colorMapping);
}

/* This function decreases the number of nodes associated with the segment the passed node belongs to.
  If the count reaches 0, the segment is removed from the mapping and this function returns true.
  Otherwise the return value will be false. */
function onNodeDeleted(mergerModeState: MergerModeState, nodeId: number) {
  const segmentId = mergerModeState.nodeSegmentMap[nodeId];
  const numberOfNodesMappedToSegment = decreaseNodesOfSegment(segmentId, mergerModeState);

  if (numberOfNodesMappedToSegment === 0) {
    // Reset color of all segments that were mapped to this tree
    deleteColorMappingOfSegment(segmentId, mergerModeState);
    return true;
  }
  return false;
}

/* Make sure that a segment changes back its color as soon as all
   nodes are deleted from it. */
function deleteNode(mergerModeState: MergerModeState, nodeId: number) {
  const noNodesLeftForTheSegment = onNodeDeleted(mergerModeState, nodeId);
  if (noNodesLeftForTheSegment) {
    api.data.setMapping(mergerModeState.segmentationLayerName, mergerModeState.colorMapping);
  }
}

function updateState(mergerModeState: MergerModeState, skeletonTracing: SkeletonTracing) {
  const diff = cachedDiffTrees(mergerModeState.prevTracing, skeletonTracing);

  for (const action of diff) {
    switch (action.name) {
      case "createNode": {
        const { treeId, id: nodeId, position } = action.value;
        createNode(mergerModeState, nodeId, treeId, position);
        break;
      }
      case "deleteNode":
        deleteNode(mergerModeState, action.value.nodeId);
        break;
      default:
        break;
    }
  }

  mergerModeState.prevTracing = skeletonTracing;
}

type WriteableDatasetLayerConfiguration = {
  [name: string]: { isDisabled: boolean },
};

// Changes the opacity of the segmentation layer
function changeOpacity(mergerModeState: MergerModeState) {
  const { segmentationLayerName } = mergerModeState;
  const layerSettings = api.data.getConfiguration("layers");
  // Invert the visibility of the segmentation layer.
  const copyOfLayerSettings: WriteableDatasetLayerConfiguration = (_.cloneDeep(layerSettings): any);
  const isSegmentationDisabled = copyOfLayerSettings[segmentationLayerName].isDisabled;
  copyOfLayerSettings[segmentationLayerName].isDisabled = !isSegmentationDisabled;
  api.data.setConfiguration("layers", copyOfLayerSettings);
}

function shuffleColorOfCurrentTree(mergerModeState: MergerModeState) {
  const { treeColors, colorMapping, segmentationLayerName } = mergerModeState;
  const setNewColorOfCurrentActiveTree = () => {
    const activeTreeId = api.tracing.getActiveTreeId();
    if (activeTreeId == null) {
      Modal.info({ title: "Could not find an active tree." });
      return;
    }
    const oldColor = getTreeColor(activeTreeId, mergerModeState);
    // Reset the color of the active tree
    treeColors[activeTreeId] = undefined;
    // Applies the change of the color to all connected segments
    Object.keys(colorMapping).forEach(key => {
      if (colorMapping[key] === oldColor) {
        colorMapping[key] = getTreeColor(activeTreeId, mergerModeState);
      }
    });
    // Update the segmentation
    api.data.setMapping(segmentationLayerName, colorMapping);
  };

  Modal.confirm({
    title: "Do you want to set a new Color?",
    onOk: setNewColorOfCurrentActiveTree,
    onCancel() {},
  });
}

async function mergeSegmentsOfAlreadyExistingTrees(
  index = 0,
  mergerModeState: MergerModeState,
  onProgressUpdate: number => void,
) {
  const { nodes, segmentationLayerName, nodeSegmentMap, colorMapping } = mergerModeState;
  const numbOfNodes = nodes.length;
  if (index >= numbOfNodes) {
    return;
  }

  const [segMinVec, segMaxVec] = api.data.getBoundingBox(segmentationLayerName);

  const setSegementationOfNode = async node => {
    const pos = node.position;
    const { treeId } = node;
    // Skip nodes outside segmentation
    if (
      pos[0] < segMinVec[0] ||
      pos[1] < segMinVec[1] ||
      pos[2] < segMinVec[2] ||
      pos[0] >= segMaxVec[0] ||
      pos[1] >= segMaxVec[1] ||
      pos[2] >= segMaxVec[2]
    ) {
      // The node is not in bounds of the segmentation
      return;
    }
    const segmentId = await api.data.getDataValue(segmentationLayerName, pos);
    if (segmentId != null && segmentId > 0) {
      // Store the segment id
      nodeSegmentMap[node.id] = segmentId;
      // Add to agglomerate
      increaseNodesOfSegment(segmentId, mergerModeState);
      mapSegmentColorToTree(segmentId, treeId, mergerModeState);
    }
  };

  const BATCH_SIZE = 128;
  // Batch the segmentation lookup, otherwise there are too many bucket requests at once
  // and this step will never complete
  for (let cur = 0; cur < numbOfNodes; cur += BATCH_SIZE) {
    onProgressUpdate((cur / numbOfNodes) * 100);
    const nodesMappedPromises = nodes
      .slice(cur, cur + BATCH_SIZE)
      .map(node => setSegementationOfNode(node));
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(nodesMappedPromises);
  }
  api.data.setMapping(segmentationLayerName, colorMapping);
}

function resetState(mergerModeState?: MergerModeState = {}) {
  const segmentationLayerName = api.data.getVolumeTracingLayerName();
  const defaults = {
    treeColors: {},
    colorMapping: {},
    nodesPerSegment: {},
    nodes: getAllNodesWithTreeId(),
    segmentationLayerName,
    nodeSegmentMap: {},
    prevTracing: getSkeletonTracing(Store.getState().tracing).get(),
  };
  // Keep the object identity when resetting
  return Object.assign(mergerModeState, defaults);
}

export async function enableMergerMode(onProgressUpdate: number => void) {
  if (isCodeActive) {
    return;
  }
  isCodeActive = true;
  // Create an object that stores the state of the merger mode.
  const mergerModeState: MergerModeState = resetState();
  // Register for tracing changes
  unsubscribeFunctions.push(
    Store.subscribe(() => {
      getSkeletonTracing(Store.getState().tracing).map(skeletonTracing => {
        if (skeletonTracing.tracingId !== mergerModeState.prevTracing.tracingId) {
          resetState(mergerModeState);
          api.data.setMappingEnabled(false);
        } else {
          updateState(mergerModeState, skeletonTracing);
        }
      });
    }),
  );
  // Register the additional key handlers
  unregisterKeyHandlers.push(
    api.utils.registerKeyHandler("8", () => {
      shuffleColorOfCurrentTree(mergerModeState);
    }),
  );
  unregisterKeyHandlers.push(
    api.utils.registerKeyHandler("9", () => {
      changeOpacity(mergerModeState);
    }),
  );
  // wait for preprocessing the already existing trees before returning
  await mergeSegmentsOfAlreadyExistingTrees(0, mergerModeState, onProgressUpdate);
}

export function disableMergerMode() {
  if (!isCodeActive) {
    return;
  }
  isCodeActive = false;
  unsubscribeFunctions.forEach(unsubscribeFunction => unsubscribeFunction());
  unregisterKeyHandlers.forEach(unregisterObject => unregisterObject.unregister());

  // Disable the custom merger mode mapping
  api.data.setMappingEnabled(false);
}
