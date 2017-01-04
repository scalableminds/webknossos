import _ from "lodash";
import StateLogger from "../statelogger";
import THREE from "three";
import { V3 } from "libs/mjs";
import ErrorHandling from "libs/error_handling";

class SkeletonTracingStateLogger extends StateLogger {


  constructor(flycam, flycam3d, version, tracingId, tracingType, allowUpdate, skeletonTracing) {
    super(flycam, version, tracingId, tracingType, allowUpdate);
    this.flycam3d = flycam3d;
    this.skeletonTracing = skeletonTracing;
  }


  // ### TREES

  treeObject(tree, oldId) {
    const treeColor = new THREE.Color(tree.color);
    return {
      id: oldId ? oldId : tree.treeId,
      updatedId: oldId ? tree.treeId : undefined,
      color: [treeColor.r, treeColor.g, treeColor.b, 1],
      name: tree.name,
      timestamp: tree.timestamp,
      comments: tree.comments,
      branchPoints: tree.branchpoints,
    };
  }


  createTree(tree) {
    return this.pushDiff("createTree", this.treeObject(tree));
  }


  updateTree(tree, oldId = false) {
    return this.pushDiff("updateTree", this.treeObject(tree, oldId));
  }


  deleteTree(tree) {
    return this.pushDiff("deleteTree", {
      id: tree.treeId,
    });
  }


  mergeTree(sourceTree, targetTree, lastNodeId, activeNodeId) {
    // Make sure that those nodes exist
    let found = false; let treeIds = [];
    for (var node of sourceTree.nodes) {
      found |= (node.id === lastNodeId);
      treeIds.push(node.id);
    }
    ErrorHandling.assert(found, "lastNodeId not in sourceTree",
      { sourceTreeNodeIds: treeIds, lastNodeId });

    found = false; treeIds = [];
    for (node of targetTree.nodes) {
      found |= (node.id === activeNodeId);
      treeIds.push(node.id);
    }
    ErrorHandling.assert(found, "activeNodeId not in targetTree",
      { targetTreeNodeIds: treeIds, activeNodeId });

    // Copy all edges and nodes from sourceTree to
    // targetTree, while leaving targetTree's properties
    // unchanged. Then, delete sourceTree.
    this.pushDiff("mergeTree", {
      sourceId: sourceTree.treeId,
      targetId: targetTree.treeId,
    }, false);
    return this.createEdge(lastNodeId, activeNodeId, targetTree.treeId);
  }


  // ### NODES and EDGED

  nodeObject(node, treeId) {
    return _.extend(node.metaInfo, {
      treeId,
      id: node.id,
      radius: node.radius,
      position: V3.floor(node.pos),
      rotation: node.rotation,
    },
    );
  }


  edgeObject(node, treeId) {
    ErrorHandling.assert(node.neighbors.length === 1,
      "Node has to have exactly one neighbor", node.neighbors.length);

    return {
      treeId,
      source: node.neighbors[0].id,
      target: node.id,
    };
  }


  createNode(node, treeId) {
    ErrorHandling.assert(node.neighbors.length <= 1,
      "New node can't have more than one neighbor", node.neighbors.length);
    if (node.neighbors[0]) {
      ErrorHandling.assert(node.treeId === node.neighbors[0].treeId,
        "Neighbor has different treeId",
        { treeId1: node.treeId, treeId2: node.neighbors[0].treeId });
    }

    const needsEdge = node.neighbors.length === 1;
    this.pushDiff("createNode", this.nodeObject(node, treeId), !needsEdge);
    if (needsEdge) {
      return this.pushDiff("createEdge", this.edgeObject(node, treeId));
    }
  }


  updateNode(node, treeId) {
    return this.pushDiff("updateNode", this.nodeObject(node, treeId));
  }


  deleteNode(node, treeId) {
    // Edges will be deleted implicitly
    return this.pushDiff("deleteNode", {
      treeId,
      id: node.id,
    });
  }


  moveTreeComponent(sourceId, targetId, nodeIds) {
    return this.pushDiff("moveTreeComponent", {
      sourceId,
      targetId,
      nodeIds,
    });
  }


  createEdge(source, target, treeId) {
    // used when edges are set manually, e.g. for merging trees
    return this.pushDiff("createEdge", {
      treeId,
      source,
      target,
    });
  }


  concatUpdateTracing() {
    this.pushDiff(
      "updateTracing",
      {
        activeNode: this.skeletonTracing.getActiveNodeId(),
        editPosition: V3.floor(this.flycam.getPosition()),
        editRotation: this.flycam3d.getRotation(),
        zoomLevel: this.flycam.getZoomStep(),
      },
      false,
    );
    return ErrorHandling.assert(this.newDiffs.length > 0, "newDiffs empty after concatUpdateTracing", {
      newDiffs: this.newDiffs,
    });
  }
}


export default SkeletonTracingStateLogger;
