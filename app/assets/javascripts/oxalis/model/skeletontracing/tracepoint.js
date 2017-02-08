/*
* tracepoint.js
* @flow weak
*/

import _ from "lodash";
import Utils from "libs/utils";
import type { Vector3 } from "oxalis/constants";

export type MetaInfo = {
  timestamp: number;
  viewport: number;
  resolution: number;
  bitDepth: number;
  interpolation: boolean;
}

/**
* A node in a skeleton tracing.
* @class
*/
class TracePoint {

  setChildRelation: Function;
  id: number;
  pos: Vector3;
  radius: number;
  treeId: number;
  metaInfo: MetaInfo;
  rotation: Vector3;
  neighbors: Array<TracePoint>;
  parent: TracePoint;
  seen: boolean;
  children: any;

  constructor(id: number, pos: Vector3, radius:number, treeId: number, metaInfo: MetaInfo, rotation:Vector3) {
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
    let minN;
    if (parent != null) { minN = 2; } else { minN = 1; }

    if (this.neighbors.length < minN) {
      return null;
    }

    if (this.neighbors.length === minN) {
      for (const neighbor of this.neighbors) {
        if (neighbor !== parent) {
          return neighbor;
        }
      }
    }

    return this.neighbors.filter(neighbor => neighbor !== parent);
  }


  buildTree(parent = null) {
    this.setChildRelation(parent);

    let childrenIterator = this.children;
    let parentIterator = this;

    while (childrenIterator.length === 1) {
      childrenIterator[0].setChildRelation(parentIterator);
      parentIterator = childrenIterator[0];
      childrenIterator = parentIterator.children;
    }

    return childrenIterator.map(child =>
      child.buildTree(parentIterator));
  }


  setChildRelation(parent) {
    // Make sure you only look once at every node. Assumes
    // that @seen does not exist or has been initialized
    // to false for all nodes
    this.parent = parent;
    if (this.seen) {
      throw new Error("CyclicTree");
    }
    this.seen = true;

    this.children = this.getNext(this.parent);
    if (this.children == null) {
      this.children = [];
    }
    if (!_.isArray(this.children)) {
      this.children = [this.children];
    }
  }


  removeNeighbor(id) {
    for (const i of Utils.__range__(0, this.neighbors.length, false)) {
      if (this.neighbors[i].id === id) {
        // Remove neighbor
        this.neighbors.splice(i, 1);
        return;
      }
    }
  }
}

export default TracePoint;
