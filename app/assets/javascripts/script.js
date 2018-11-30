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

  var treeColors = {};
  var colorMapping = {};
  let workingOnNode = null;

  function getTreeColor(treeId) {
    var color = treeColors[treeId];

    /* Automatically generate a new color
           if tree was never seen before */
    if (color === undefined) {
      color = Math.ceil(127 * Math.random());
      treeColors[treeId] = color;
    }

    return color;
  }

  function colorSeg(segId, treeId) {
    /* add segment to color mapping */
    var color = getTreeColor(treeId);
    colorMapping[segId] = color;
  }

  function uncolorSeg(segId) {
    /* remove segment from color mapping */
    delete colorMapping[segId];
  }

  /* For each segment keep track of the number of
       nodes that were placed within. This allows us
       to change back the color of a semgnet if and
       only if all nodes were removed from a segment. */
  var segRefs = [];

  /* This function is used to increment the
       reference count for a given segment id */
  function incrementSegRef(segId) {
    var oldValue = segRefs[segId];
    var newValue;

    /* determine new value */
    if (oldValue === undefined) {
      newValue = 1;
    } else {
      newValue = oldValue + 1;
    }

    /* return value */
    segRefs[segId] = newValue;
    return newValue;
  }

  function decrementSegRef(segId) {
    var oldValue = segRefs[segId];
    var newValue = oldValue - 1;

    /* decrement */
    segRefs[segId] = newValue;
    return newValue;
  }

  function getAllNodesWithTreeId() {
    const trees = api.tracing.getAllTrees();
    const nodes = [];
    for (const treeId in trees) {
      const currentTree = trees[treeId];
      for (const node of currentTree.nodes.values()) {
        const nodeWithTreeId = Object.assign({}, node, { treeId });
        nodes.push(nodeWithTreeId);
      }
    }

    return nodes;
  }

  const nodes = getAllNodesWithTreeId();

  const nodeCount = nodes.length;
  const nodeSegmentMap = {};

  const segmentationOpacity = api.data.getConfiguration("segmentationOpacity");
  let segmentationOn = true;

  /* Here we intercept calls to the "addNode" method. This
       allows us to look up the segment id at the specified
       point and display it in the same color as the rest of
       the aggregate. */

  async function createNodeOverwrite(store, call, action) {
    call(action);

    const pos = action.position;
    // getVolumeTracingLayerName
    const segmentId = await api.data.getDataValue("segmentation", pos);

    const activeTreeId = api.tracing.getActiveTreeId();
    const activeNodeId = api.tracing.getActiveNodeId();

    if (!segmentId) {
      alert("You've set a point too close to grey. The node will be removed now.");
      api.tracing.deleteNode(activeNodeId, activeTreeId);
      return;
    }

    /* set segment id */
    nodeSegmentMap[activeNodeId] = segmentId;

    /* count references */
    incrementSegRef(segmentId);
    colorSeg(segmentId, activeTreeId);

    /* color in segment */
    api.data.setMapping("segmentation", colorMapping);
  }
  api.utils.registerOverwrite("CREATE_NODE", createNodeOverwrite);

  /* Overwrite the "deleteActiveNode" method in such a way
       that a segment changes back its color as soon as all
       nodes are deleted from it. */

  function deleteActiveNodeOverwrite(store, call, action) {
    var activeNodeId = api.tracing.getActiveNodeId();

    if (activeNodeId == null) {
      return;
    }

    /* query segment id */
    var segmentId = nodeSegmentMap[activeNodeId];
    var newSegRef = decrementSegRef(segmentId);

    /* recolor if needed */
    if (newSegRef == 0) {
      uncolorSeg(segmentId);
      api.data.setMapping("segmentation", colorMapping);
    }

    /* remove node */
    call(action);
  }
  api.utils.registerOverwrite("DELETE_NODE", deleteActiveNodeOverwrite);

  function toggleAlpha() {
    if (segmentationOn) {
      api.data.setConfiguration("segmentationOpacity", 0);
      segmentationOn = false;
    } else {
      api.data.setConfiguration("segmentationOpacity", segmentationOpacity);
      segmentationOn = true;
    }
  }
  function shuffleColor() {
    alert("Setting new color...");

    /* get id of active tree */
    var activeTreeId = api.tracing.getActiveTreeId();
    var oldColor = getTreeColor(activeTreeId);

    treeColors[activeTreeId] = undefined;

    var keys = Object.keys(colorMapping);
    for (var idx = 0; idx < keys.length; idx++) {
      if (colorMapping[keys[idx]] === oldColor)
        colorMapping[keys[idx]] = getTreeColor(activeTreeId);
    }

    /* color in segment */
    api.data.setMapping("segmentation", colorMapping);
    alert("Done!");
  }

  async function restorePink(index = 0) {
    if (index >= nodeCount) {
      return;
    }

    if (workingOnNode > index) {
      return;
    }

    /* show progress */
    if (index % 50 == 0) {
      /* TODO: Make visible to user */
      console.log("Processing node " + index + " of " + nodeCount);
    }

    var node = nodes[index];
    var pos = node.position;

    var treeId = node.treeId;

    const [segMinVec, segMaxVec] = api.data.getBoundingBox("segmentation");

    /* skip nodes outside segmentation */
    if (
      pos[0] < segMinVec[0] ||
      pos[1] < segMinVec[1] ||
      pos[2] < segMinVec[2] ||
      pos[0] >= segMaxVec[0] ||
      pos[1] >= segMaxVec[1] ||
      pos[2] >= segMaxVec[2]
    ) {
      return restorePink(index + 1);
    }

    /* set working node */
    workingOnNode = index;

    if (workingOnNode > index) {
      return;
    }

    /* TODO: Make visible to user */
    console.log("Retrying node " + (index + 1) + " of " + nodeCount);

    const segmentId = await api.data.getDataValue("segmentation", pos);
    /* this should never happen */
    if (segmentId === null) {
      return;
    }

    if (segmentId > 0) {
      /* store segment id */
      nodeSegmentMap[node.id] = segmentId;

      /* add to agglomerate */
      incrementSegRef(segmentId);
      colorSeg(segmentId, treeId);
      console.log("set", segmentId, treeId);
    }

    if (index < nodeCount - 1) {
      /* continue with next node if needed */
      await restorePink(index + 1);
    } else {
      workingOnNode = nodeCount;
      api.data.setMapping("segmentation", colorMapping);

      alert("Done!");
    }
  }

  api.utils.registerKeyHandler("9", () => {
    toggleAlpha();
  });
  api.utils.registerKeyHandler("8", () => {
    shuffleColor();
  });

  alert(welcomeMessage);
  restorePink();
});
