/*
* tracepoint.js
* @flow weak
*/

import _ from "lodash";
import Utils from "libs/utils";
import type { Vector3 } from "oxalis/constants";
import { V3 } from "libs/mjs";

/**
* A node in a skeleton tracing.
* @class
*/
class TracePoint {

  setChildRelation: Function;
  id: number;
  radius: number;
  treeId: number;
  rotation: Vector3;
  position: Vector3;
  neighbors: Array<TracePoint>;
  parent: TracePoint;
  seen: boolean;
  children: any;
  timestamp: number;
  viewport: number;
  resolution: number;
  bitDepth: number;
  interpolation: boolean

  constructor(id: number, position: Vector3, radius:number, treeId: number, rotation:Vector3, timestamp: number, viewport: ?number, resolution: ?number, bitDepth: ?number, interpolation: ?boolean) {
    this.setChildRelation = this.setChildRelation.bind(this);
    this.id = id;
    this.position = position;
    this.radius = radius;
    this.treeId = treeId;
    this.rotation = rotation;
    this.neighbors = [];
    this.timestamp = timestamp;
    this.viewport = viewport || 0;
    this.resolution = resolution || 0;
    this.bitDepth = bitDepth || 0;
    this.interpolation = interpolation || false;
  }

  toJSON() {
    const serverNode = _.clone(this);
    serverNode.position = V3.floor(this.position), // server expects integer positions :-P
    delete serverNode.neighbors;
    delete serverNode.children;

    return serverNode;
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
