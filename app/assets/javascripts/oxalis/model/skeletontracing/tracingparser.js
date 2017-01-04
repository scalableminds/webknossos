import _ from "lodash";
import THREE from "three";
import Toast from "libs/toast";
import TracePoint from "./tracepoint";
import TraceTree from "./tracetree";

class TracingParser {


  constructor(skeletonTracing, data) {
    this.skeletonTracing = skeletonTracing;
    this.data = data;
    this.idCount = 1;
    this.treeIdCount = 1;
    this.trees = [];
    this.activeNode = null;
    this.activeTree = null;
  }


  buildTrees() {
    for (const treeData of this.data.trees) {
      // Create new tree
      const tree = new TraceTree(
        treeData.id,
        this.convertColor(treeData.color),
        treeData.name ? treeData.name : `Tree${(`00${treeData.id}`).slice(-3)}`,
        treeData.timestamp,
        treeData.comments,
        treeData.branchPoints);

      // Initialize nodes
      for (const node of treeData.nodes) {
        const metaInfo = _.pick(node,
          "timestamp", "viewport", "resolution", "bitDepth", "interpolation");

        tree.nodes.push(
          new TracePoint(
            node.id, node.position, node.radius, treeData.id,
            metaInfo, node.rotation));

        // idCount should be bigger than any other id
        this.idCount = Math.max(node.id + 1, this.idCount);
      }

      // Initialize edges
      for (const edge of treeData.edges) {
        const sourceNode = this.skeletonTracing.findNodeInList(tree.nodes, edge.source);
        const targetNode = this.skeletonTracing.findNodeInList(tree.nodes, edge.target);
        if (sourceNode && targetNode) {
          sourceNode.appendNext(targetNode);
          targetNode.appendNext(sourceNode);
        } else {
          if (!sourceNode) { Toast.error(`Node with id ${edge.source} doesn't exist. Ignored edge due to missing source node.`); }
          if (!targetNode) { Toast.error(`Node with id ${edge.target} doesn't exist. Ignored edge due to missing target node.`); }
        }
      }

      // Set active Node
      const activeNodeT = this.skeletonTracing.findNodeInList(tree.nodes, this.data.activeNode);
      if (activeNodeT) {
        this.activeNode = activeNodeT;
        // Active Tree is the one last added
        this.activeTree = tree;
      }

      this.treeIdCount = Math.max(tree.treeId + 1, this.treeIdCount);
      this.trees.push(tree);
    }

    if (this.data.activeNode && !this.activeNode) {
      return Toast.error(`Node with id ${this.data.activeNode} doesn't exist. Ignored active node.`);
    }
  }


  convertColor(colorArray) {
    if (colorArray != null) {
      return new THREE.Color().setRGB(...colorArray).getHex();
    }

    return null;
  }


  parse() {
    if (this.data == null) {
      return {
        idCount: 0,
        treeIdCount: 0,
        trees: [],
        activeNode: null,
        activeTree: null,
      };
    }

    this.buildTrees();

    let nodeList = [];
    for (const tree of this.trees) {
      nodeList = nodeList.concat(tree.nodes);
    }

    return {
      idCount: this.idCount,
      treeIdCount: this.treeIdCount,
      trees: this.trees,
      activeNode: this.activeNode,
      activeTree: this.activeTree,
    };
  }
}

export default TracingParser;
