import { Modal } from "antd";

window.webknossos.apiReady(3).then(async api => {
  const welcomeMessage = `Mr. Motta and Mr. Boergens proudly present
    The webKnossos Merger Mode Suite (version 23.04.2017)

    1. enable everthing that it is working
    2. enable in hybrid -> fix: 


    -> in hybrid tracing and support in skeleton tracing
    -> enabling in segementation tab (mappings view tab)
    [8] Shuffles segmentation color of current tree -> todo
    [9] Toggles segment opacity -> todo
    [right-click] Adds node and makes segment pink -> verbinden von unterschiedlichen segementen gleich anmalen
    [delete] Removes node and restores original segment color -> todo

    Please watch messages in console as data is loaded.
    If it doesn not run to the end, please inform us.`;

  const treeColors = {};
  const colorMapping = {};
  // let workingOnNode = null;

  /* For each segment keep track of the number of
     nodes that were placed within. This allows us
     to change back the color of a segment if and
     only if all nodes were removed from a segment. */
  const nodesPerSegment = [];

  function getTreeColor(treeId) {
    let color = treeColors[treeId];
    // generate a new color if tree was never seen before
    if (color === undefined) {
      color = Math.ceil(127 * Math.random());
      treeColors[treeId] = color;
    }
    return color;
  }

  function mapSegmentColorToTree(segId, treeId) {
    // add segment to color mapping
    const color = getTreeColor(treeId);
    colorMapping[segId] = color;
  }

  function deleteColorMappingOfSegment(segId) {
    // remove segment from color mapping
    delete colorMapping[segId];
  }

  /* This function is used to increment the reference count /
     number of nodes mapped to the given segment */
  function increaseNodesOfSegment(segementId) {
    const currentValue = nodesPerSegment[segementId];
    if (currentValue === undefined) {
      nodesPerSegment[segementId] = 1;
    } else {
      nodesPerSegment[segementId] = currentValue + 1;
    }
    return nodesPerSegment[segementId];
  }

  /* This function is used to decrement the reference count /
     number of nodes mapped to the given segment */
  function decreaseNodesOfSegment(segementId) {
    const currentValue = nodesPerSegment[segementId];
    nodesPerSegment[segementId] = currentValue - 1;
    return nodesPerSegment[segementId];
  }

  function getAllNodesWithTreeId() {
    const trees = api.tracing.getAllTrees();
    const nodes = [];
    // consider using lodash to create a deep copy and than modify
    // this copy by adding the tree id to each node => alrighty
    Object.keys(trees).forEach(treeId => {
      const currentTree = trees[treeId];
      for (const node of currentTree.nodes.values()) {
        const nodeWithTreeId = Object.assign({}, node, { treeId });
        nodes.push(nodeWithTreeId);
      }
    });
    return nodes;
  }

  const nodes = getAllNodesWithTreeId();
  const segementationLayerName = api.tracing.getVolumeTracingLayerName();

  // const nodeCount = nodes.length;
  const nodeSegmentMap = {};

  const segmentationOpacity = api.data.getConfiguration("segmentationOpacity");
  let segmentationOn = true;

  /* Here we intercept calls to the "addNode" method. This allows us to look up the segment id at the specified
    point and display it in the same color as the rest of the aggregate. */

  async function createNodeOverwrite(store, call, action) {
    call(action);

    const pos = action.position;
    const segmentId = await api.data.getDataValue(segementationLayerName, pos);

    const activeTreeId = api.tracing.getActiveTreeId();
    const activeNodeId = api.tracing.getActiveNodeId();

    // If there is no segment id, the node was set to close to a border between segments
    if (!segmentId) {
      Modal.info({ title: "You've set a point too close to grey. The node will be removed now." });
      api.tracing.deleteNode(activeNodeId, activeTreeId);
      return;
    }

    // set segment id
    nodeSegmentMap[activeNodeId] = segmentId;

    // count references
    increaseNodesOfSegment(segmentId);
    mapSegmentColorToTree(segmentId, activeTreeId);

    // update mapping
    api.data.setMapping(segementationLayerName, colorMapping);
  }
  api.utils.registerOverwrite("CREATE_NODE", createNodeOverwrite);

  /* Overwrite the "deleteActiveNode" method in such a way
     that a segment changes back its color as soon as all
     nodes are deleted from it.  
     => also do this on tree delete if possible (later) */
  function deleteActiveNodeOverwrite(store, call, action) {
    const activeNodeId = api.tracing.getActiveNodeId();
    if (activeNodeId == null) {
      return;
    }

    const segmentId = nodeSegmentMap[activeNodeId];
    const numberOfNodesMappedToSegment = decreaseNodesOfSegment(segmentId);

    if (numberOfNodesMappedToSegment === 0) {
      // Reset color of all segments that were mapped to this tree
      deleteColorMappingOfSegment(segmentId);
      api.data.setMapping(segementationLayerName, colorMapping);
    }
    call(action);
  }
  api.utils.registerOverwrite("DELETE_NODE", deleteActiveNodeOverwrite);

  // changes the opacity of the segmentation layer
  function changeOpacity() {
    if (segmentationOn) {
      api.data.setConfiguration("segmentationOpacity", 0);
      segmentationOn = false;
    } else {
      api.data.setConfiguration("segmentationOpacity", segmentationOpacity);
      segmentationOn = true;
    }
  }

  function shuffleColorOfCurrentTree() {
    const setNewColorOfCurrentActiveTree = () => {
      const activeTreeId = api.tracing.getActiveTreeId();
      const oldColor = getTreeColor(activeTreeId);
      // reset color of active tree
      treeColors[activeTreeId] = undefined;
      // applied the change of color to all segments with the same color
      Object.keys(colorMapping).forEach(key => {
        if (colorMapping[key] === oldColor) {
          colorMapping[key] = getTreeColor(activeTreeId);
        }
      });
      // update segmentation
      api.data.setMapping(segementationLayerName, colorMapping);
    };

    Modal.confirm({
      title: "Do you want to set a new Color?",
      onOk: setNewColorOfCurrentActiveTree,
      onCancel() {},
    });
  }

  async function restorePink(index = 0, workingOnNode = null) {
    const numbOfNodes = nodes.length;
    if (index >= numbOfNodes || workingOnNode > index) {
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

    // skip nodes outside segmentation
    if (
      pos[0] < segMinVec[0] ||
      pos[1] < segMinVec[1] ||
      pos[2] < segMinVec[2] ||
      pos[0] >= segMaxVec[0] ||
      pos[1] >= segMaxVec[1] ||
      pos[2] >= segMaxVec[2]
    ) {
      restorePink(index + 1);
      return;
    }

    // set working node
    workingOnNode = index;

    // why ?
    /* if (workingOnNode > index) {
      return;
    } */

    // TODO: Make visible to user
    // why here a + 1?
    console.log(`Retrying node ${index + 1} of ${numbOfNodes}`);

    const segmentId = await api.data.getDataValue(segementationLayerName, pos);
    // this should never happen
    if (segmentId === null) {
      return;
    }

    if (segmentId > 0) {
      // store segment id
      nodeSegmentMap[node.id] = segmentId;

      // add to agglomerate
      increaseNodesOfSegment(segmentId);
      mapSegmentColorToTree(segmentId, treeId);
      console.log("set", segmentId, treeId);
    }

    if (index < numbOfNodes - 1) {
      // continue with next node if needed
      restorePink(index + 1);
    } else {
      workingOnNode = numbOfNodes;
      api.data.setMapping("segmentation", colorMapping);

      alert("Done!");
    }
  }

  api.utils.registerKeyHandler("9", () => {
    changeOpacity();
  });
  api.utils.registerKeyHandler("8", () => {
    shuffleColorOfCurrentTree();
  });
  // todo fancify this
  alert(welcomeMessage);
  restorePink(0);
});
