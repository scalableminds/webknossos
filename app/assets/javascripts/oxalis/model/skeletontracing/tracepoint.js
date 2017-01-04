

class TracePoint {

  constructor(id, pos, radius, treeId, metaInfo, rotation) {

    this.setChildRelation = this.setChildRelation.bind(this);
    this.id = id;
    this.pos = pos;
    this.radius = radius;
    this.treeId = treeId;
    this.metaInfo = metaInfo;
    this.rotation = rotation;
    this.neighbors = [];
  }


  appendNext(next) {

    return this.neighbors.push(next);
  }


  getNext(parent) {

    let minN, neighbor;
    if (parent != null) { minN = 2; } else { minN = 1; }

    if (this.neighbors.length < minN) {
      return null;
    }

    if (this.neighbors.length === minN) {
      for (neighbor of this.neighbors) {
        if (neighbor !== parent) {
          return neighbor;
        }
      }
    }

    const res = [];
    for (neighbor of this.neighbors) {
      if (neighbor !== parent) {
        res.push(neighbor);
      }
    }
    return res;
  }


  buildTree(parent = null) {

    this.setChildRelation(parent);

    let childrenIterator = this.children;
    let parentIterator   = this;

    while (childrenIterator.length === 1) {
      childrenIterator[0].setChildRelation(parentIterator);
      parentIterator = childrenIterator[0];
      childrenIterator = parentIterator.children;
    }

    return childrenIterator.map((child) =>
      child.buildTree(parentIterator));
  }


  setChildRelation(parent) {

    // Make sure you only look once at every node. Assumes
    // that @_seen does not exist or has been initialized
    // to false for all nodes
    this.parent = parent;
    if (this._seen) {
      throw "CyclicTree";
    }
    this._seen = true;

    this.children = this.getNext(this.parent);
    if (this.children == null) {
      this.children = [];
    }
    if (!_.isArray(this.children)) {
      return this.children = [this.children];
    }
  }


  removeNeighbor(id) {

    for (let i of __range__(0, this.neighbors.length, false)) {
      if (this.neighbors[i].id === id) {
        // Remove neighbor
        this.neighbors.splice(i, 1);
        return;
      }
    }
  }
}

export default TracePoint;

function __range__(left, right, inclusive) {
  let range = [];
  let ascending = left < right;
  let end = !inclusive ? right : ascending ? right + 1 : right - 1;
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i);
  }
  return range;
}
