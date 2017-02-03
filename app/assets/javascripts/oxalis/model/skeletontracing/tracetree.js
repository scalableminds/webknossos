/*
* tracetree.js
* @flow weak
*/
import Utils from "libs/utils";
import Tracepoint from "./tracepoint";

/**
* A single tree of skeleton tracing nodes.
* @class
*/
class TraceTree {

  treeId: number;
  color: string;
  name: string;
  timestamp: number;
  comments: Array<string>;
  branchPoints: Array<Tracepoint>;
  nodes: Array<Tracepoint>;

  constructor(treeId: number, color: string, name: string, timestamp: number, comments: Array<string> = [], branchPoints: Array<Tracepoint> = []) {
    this.treeId = treeId;
    this.color = color;
    this.name = name;
    this.timestamp = timestamp;
    this.comments = comments;
    this.branchPoints = branchPoints;
    this.nodes = [];
  }


  removeNode(id) {
    // return whether a comment or branchpoint was deleted
    // as a result of the removal of this node
    let updateTree = false;
    updateTree = updateTree || this.removeCommentWithNodeId(id);
    updateTree = updateTree || this.removeBranchWithNodeId(id);

    for (const i of Utils.__range__(0, this.nodes.length, false)) {
      if (this.nodes[i].id === id) {
        this.nodes.splice(i, 1);
        break;
      }
    }

    return updateTree;
  }


  removeCommentWithNodeId(id): boolean {
    for (const i of Utils.__range__(0, this.comments.length, false)) {
      if (this.comments[i].node === id) {
        this.comments.splice(i, 1);
        return true;
      }
    }
    return false;
  }


  removeBranchWithNodeId(id) {
    for (const i of Utils.__range__(0, this.branchPoints.length, false)) {
      if (this.branchPoints[i].id === id) {
        this.branchPoints.splice(i, 1);
        return true;
      }
    }
    return false;
  }


  isBranchPoint(id) {
    return (this.branchPoints.map(node => node.id)).includes(id);
  }


  buildTree() {
    // Use node with minimal ID as root
    let root;
    for (const node of this.nodes) {
      // Initialize Cyclic tree detection
      node.seen = false;

      // define root as the node with smallest id
      if (root != null) {
        if (root.id > node.id) { root = node; }
      } else {
        root = node;
      }
    }

    if (root != null) {
      root.buildTree();
    }

    return root;
  }
}

export default TraceTree;
