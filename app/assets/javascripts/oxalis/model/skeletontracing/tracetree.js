class TraceTree {

  constructor(treeId, color, name, timestamp, comments = [], branchpoints = []) {
    this.treeId = treeId;
    this.color = color;
    this.name = name;
    this.timestamp = timestamp;
    this.comments = comments;
    this.branchpoints = branchpoints;
    this.nodes = [];
  }


  removeNode(id) {
    // return whether a comment or branchpoint was deleted
    // as a result of the removal of this node
    let updateTree = false;
    updateTree |= this.removeCommentWithNodeId(id);
    updateTree |= this.removeBranchWithNodeId(id);

    for (const i of __range__(0, this.nodes.length, false)) {
      if (this.nodes[i].id === id) {
        this.nodes.splice(i, 1);
        return updateTree;
      }
    }
  }


  removeCommentWithNodeId(id) {
    for (const i of __range__(0, this.comments.length, false)) {
      if (this.comments[i].node === id) {
        this.comments.splice(i, 1);
        return true;
      }
    }
  }


  removeBranchWithNodeId(id) {
    for (const i of __range__(0, this.branchpoints.length, false)) {
      if (this.branchpoints[i].id === id) {
        this.branchpoints.splice(i, 1);
        return true;
      }
    }
  }


  isBranchPoint(id) {
    return (this.branchpoints.map(node => node.id)).includes(id);
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

function __range__(left, right, inclusive) {
  const range = [];
  const ascending = left < right;
  const end = !inclusive ? right : ascending ? right + 1 : right - 1;
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i);
  }
  return range;
}
