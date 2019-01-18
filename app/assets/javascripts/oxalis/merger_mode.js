// @flow
import { Modal } from "antd";
import type { Node, TreeMap } from "oxalis/store";
import api from "oxalis/api/internal_api";

type NodeWithTreeId = Node & { treeId: number };

type MergerModeState = {
  treeColors: Object,
  colorMapping: Object,
  nodesPerSegment: Object,
  nodes: Array<NodeWithTreeId>,
  segementationLayerName: string,
  nodeSegmentMap: Object,
  segmentationOpacity: any,
  segmentationOn: boolean,
};

const unregisterKeyHandlers = [];
const unregisterOverwrites = [];
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
  const currentValue = nodesPerSegment.segementId;
  nodesPerSegment[segementId] = currentValue - 1;
  return nodesPerSegment.segementId;
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
/* Here we intercept calls to the "addNode" method. This allows us to look up the segment id at the specified
   point and display it in the same color as the rest of the aggregate. */
async function createNodeOverwrite(store, call, action, mergerModeState: MergerModeState) {
  call(action);
  const { colorMapping, segementationLayerName, nodeSegmentMap } = mergerModeState;
  const pos = action.position;
  const segmentId = await api.data.getDataValue(segementationLayerName, pos);

  const activeTreeId = api.tracing.getActiveTreeId();
  const activeNodeId = api.tracing.getActiveNodeId();
  // If the node wasn't created. This should never happen.
  if (activeTreeId == null || activeNodeId == null) {
    Modal.info({ title: "The created node could not be detected." });
    return;
  }
  // If there is no segment id, the node was set too close to a border between segments.
  if (!segmentId) {
    Modal.info({ title: "You've set a point too close to grey. The node will be removed now." });
    api.tracing.deleteNode(activeNodeId, activeTreeId);
    return;
  }

  // Set segment id
  nodeSegmentMap[activeNodeId] = segmentId;
  // Count references
  increaseNodesOfSegment(segmentId, mergerModeState);
  mapSegmentColorToTree(segmentId, activeTreeId, mergerModeState);

  // Update mapping
  api.data.setMapping(segementationLayerName, colorMapping);
}

/* Overwrite the "deleteActiveNode" method in such a way that a segment changes back its color as soon as all
   nodes are deleted from it. => also do this on tree delete if possible (later) */
function deleteActiveNodeOverwrite(store, call, action, mergerModeState: MergerModeState) {
  const activeNodeId = api.tracing.getActiveNodeId();
  if (activeNodeId == null) {
    return;
  }

  const segmentId = mergerModeState.nodeSegmentMap[activeNodeId];
  const numberOfNodesMappedToSegment = decreaseNodesOfSegment(segmentId, mergerModeState);

  if (numberOfNodesMappedToSegment === 0) {
    // Reset color of all segments that were mapped to this tree
    deleteColorMappingOfSegment(segmentId, mergerModeState);
    api.data.setMapping(mergerModeState.segementationLayerName, mergerModeState.colorMapping);
  }
  call(action);
}

// Changes the opacity of the segmentation layer
function changeOpacity(mergerModeState: MergerModeState) {
  if (mergerModeState.segmentationOn) {
    api.data.setConfiguration("segmentationOpacity", 0);
    mergerModeState.segmentationOn = false;
  } else {
    api.data.setConfiguration("segmentationOpacity", mergerModeState.segmentationOpacity);
    mergerModeState.segmentationOn = true;
  }
}

function shuffleColorOfCurrentTree(mergerModeState: MergerModeState) {
  const { treeColors, colorMapping, segementationLayerName } = mergerModeState;
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
    api.data.setMapping(segementationLayerName, colorMapping);
  };

  Modal.confirm({
    title: "Do you want to set a new Color?",
    onOk: setNewColorOfCurrentActiveTree,
    onCancel() {},
  });
}

async function mergeSegmentsOfAlreadyExistingTrees(index = 0, mergerModeState: MergerModeState) {
  const { nodes, segementationLayerName, nodeSegmentMap, colorMapping } = mergerModeState;
  const numbOfNodes = nodes.length;
  if (index >= numbOfNodes) {
    return;
  }

  if (index % 50 === 0) {
    // TODO: Make visible to user
    console.log(`Processing node ${index} of ${numbOfNodes}`);
  }

  const node = nodes[index];
  const pos = node.position;
  const treeId = node.treeId;

  const [segMinVec, segMaxVec] = api.data.getBoundingBox(segementationLayerName);

  // Skip nodes outside segmentation
  if (
    pos[0] < segMinVec[0] ||
    pos[1] < segMinVec[1] ||
    pos[2] < segMinVec[2] ||
    pos[0] >= segMaxVec[0] ||
    pos[1] >= segMaxVec[1] ||
    pos[2] >= segMaxVec[2]
  ) {
    mergeSegmentsOfAlreadyExistingTrees(index + 1, mergerModeState);
    return;
  }

  const segmentId = await api.data.getDataValue(segementationLayerName, pos);
  // This should never happen
  if (segmentId === null) {
    return;
  }

  if (segmentId > 0) {
    // Store the segment id
    nodeSegmentMap[node.id] = segmentId;

    // Add to agglomerate
    increaseNodesOfSegment(segmentId, mergerModeState);
    mapSegmentColorToTree(segmentId, treeId, mergerModeState);
    console.log("set", segmentId, treeId);
  }

  if (index < numbOfNodes - 1) {
    // Continue with next node if needed
    mergeSegmentsOfAlreadyExistingTrees(index + 1, mergerModeState);
  } else {
    api.data.setMapping("segmentation", colorMapping);
  }
}

export function enableMergerMode() {
  if (isCodeActive) {
    return;
  }
  isCodeActive = true;
  // Create an object that store the state of the merger mode.
  const mergerModeState: MergerModeState = {
    treeColors: {},
    colorMapping: {},
    nodesPerSegment: {},
    nodes: getAllNodesWithTreeId(),
    segementationLayerName: api.data.getVolumeTracingLayerName(),
    nodeSegmentMap: {},
    segmentationOpacity: api.data.getConfiguration("segmentationOpacity"),
    segmentationOn: true,
  };
  // Register the overwrites
  unregisterOverwrites.push(
    api.utils.registerOverwrite("CREATE_NODE", (store, next, originalAction) =>
      createNodeOverwrite(store, next, originalAction, mergerModeState),
    ),
  );
  unregisterOverwrites.push(
    api.utils.registerOverwrite("DELETE_NODE", (store, next, originalAction) =>
      deleteActiveNodeOverwrite(store, next, originalAction, mergerModeState),
    ),
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
  mergeSegmentsOfAlreadyExistingTrees(0, mergerModeState);
}

export function disableMergerMode() {
  if (!isCodeActive) {
    return;
  }
  isCodeActive = false;
  unregisterOverwrites.forEach(unregisterFunction => unregisterFunction());
  unregisterKeyHandlers.forEach(unregisterObject => unregisterObject.unregister());
}
