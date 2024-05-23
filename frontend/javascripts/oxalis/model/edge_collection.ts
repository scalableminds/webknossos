import _ from "lodash";
import type { Edge } from "oxalis/store";
import DiffableMap, { diffDiffableMaps } from "libs/diffable_map";
import * as Utils from "libs/utils";
type EdgeMap = DiffableMap<number, Array<Edge>>;
export default class EdgeCollection {
  // Edge map keyed by the source id of the edges (outgoing)
  outMap: EdgeMap;
  // Edge map keyed by the target id of the edges (ingoing)
  inMap: EdgeMap;
  edgeCount: number;

  constructor(itemsPerBatch?: number) {
    this.outMap = new DiffableMap(null, itemsPerBatch);
    this.inMap = new DiffableMap(null, itemsPerBatch);
    this.edgeCount = 0;
  }

  getEdgesForNode(nodeId: number): Array<Edge> {
    return this.getOutgoingEdgesForNode(nodeId).concat(this.getIngoingEdgesForNode(nodeId));
  }

  getOutgoingEdgesForNode(nodeId: number): Array<Edge> {
    return this.outMap.getNullable(nodeId) || [];
  }

  getIngoingEdgesForNode(nodeId: number): Array<Edge> {
    return this.inMap.getNullable(nodeId) || [];
  }

  addEdges(edges: Array<Edge>, mutate: boolean = false): EdgeCollection {
    const newOutgoingEdges = mutate ? this.outMap : this.outMap.clone();
    const newIngoingEdges = mutate ? this.inMap : this.inMap.clone();
    const newEdgeCount = this.edgeCount + edges.length;

    for (const edge of edges) {
      const outgoingEdges = newOutgoingEdges.getNullable(edge.source) || [];
      const ingoingEdges = newIngoingEdges.getNullable(edge.target) || [];
      newOutgoingEdges.mutableSet(edge.source, outgoingEdges.concat(edge));
      newIngoingEdges.mutableSet(edge.target, ingoingEdges.concat(edge));
    }

    if (mutate) {
      this.edgeCount = newEdgeCount;
      return this;
    } else {
      return EdgeCollection.loadFromMaps(newOutgoingEdges, newIngoingEdges, newEdgeCount);
    }
  }

  addEdge(edge: Edge, mutate: boolean = false): EdgeCollection {
    // This is a performance optimized version of addEdges for a single edge.
    // In the single-edge case, it is faster to call .set on the diffable map which will
    // clone only the affected chunk and not all chunks (as addEdges).
    const newEdgeCount = this.edgeCount + 1;
    const outgoingEdges = this.outMap.getNullable(edge.source) || [];
    const ingoingEdges = this.inMap.getNullable(edge.target) || [];

    if (mutate) {
      this.outMap.mutableSet(edge.source, outgoingEdges.concat(edge));
      this.inMap.mutableSet(edge.target, ingoingEdges.concat(edge));
      this.edgeCount = newEdgeCount;
      return this;
    } else {
      const newOutgoingEdges = this.outMap.set(edge.source, outgoingEdges.concat(edge));
      const newIngoingEdges = this.inMap.set(edge.target, ingoingEdges.concat(edge));
      return EdgeCollection.loadFromMaps(newOutgoingEdges, newIngoingEdges, newEdgeCount);
    }
  }

  removeEdge(edge: Edge): EdgeCollection {
    const outgoingEdges = this.outMap.getNullable(edge.source) || [];
    const ingoingEdges = this.inMap.getNullable(edge.target) || [];
    const newOutgoingEdges = outgoingEdges.filter((e) => e.target !== edge.target);
    const newOutgoingEdgeMap =
      newOutgoingEdges.length > 0
        ? this.outMap.set(edge.source, newOutgoingEdges)
        : this.outMap.delete(edge.source);
    const newIngoingEdges = ingoingEdges.filter((e) => e.source !== edge.source);
    const newIngoingEdgeMap =
      newIngoingEdges.length > 0
        ? this.inMap.set(edge.target, newIngoingEdges)
        : this.inMap.delete(edge.target);
    return EdgeCollection.loadFromMaps(newOutgoingEdgeMap, newIngoingEdgeMap, this.edgeCount - 1);
  }

  map<T>(fn: (value: Edge) => T): Array<T> {
    return this.asArray().map(fn);
  }

  *all(): Generator<Edge, void, void> {
    for (const edgeArray of this.outMap.values()) {
      for (const edge of edgeArray) {
        yield edge;
      }
    }
  }

  asArray(): Array<Edge> {
    return Array.from(this.all());
  }

  size(): number {
    return this.edgeCount;
  }

  clone(): EdgeCollection {
    const cloned = new EdgeCollection();
    cloned.outMap = this.outMap.clone();
    cloned.inMap = this.inMap.clone();
    cloned.edgeCount = this.edgeCount;
    return cloned;
  }

  static loadFromArray(edges: Array<Edge>): EdgeCollection {
    // Build up temporary data structures for fast bulk processing
    const rawOutMap: Record<number, Array<Edge>> = {};
    const rawInMap: Record<number, Array<Edge>> = {};
    edges.forEach((edge) => {
      if (rawOutMap[edge.source]) {
        rawOutMap[edge.source].push(edge);
      } else {
        rawOutMap[edge.source] = [edge];
      }

      if (rawInMap[edge.target]) {
        rawInMap[edge.target].push(edge);
      } else {
        rawInMap[edge.target] = [edge];
      }
    });
    // Transfer the built up data into an EdgeCollection
    const outMap = new DiffableMap();
    const inMap = new DiffableMap();
    Object.keys(rawOutMap).forEach((key) => {
      const nodeId = Number(key);
      const outgoingEdges = rawOutMap[nodeId];
      outMap.mutableSet(nodeId, outgoingEdges);
    });
    Object.keys(rawInMap).forEach((key) => {
      const nodeId = Number(key);
      const ingoingEdges = rawInMap[nodeId];
      inMap.mutableSet(nodeId, ingoingEdges);
    });
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'DiffableMap<number, unknown>' is... Remove this comment to see the full error message
    return EdgeCollection.loadFromMaps(outMap, inMap, edges.length);
  }

  static loadFromMaps(outMap: EdgeMap, inMap: EdgeMap, edgeCount: number): EdgeCollection {
    const newEdgeCollection = new EdgeCollection();
    newEdgeCollection.outMap = outMap;
    newEdgeCollection.inMap = inMap;
    newEdgeCollection.edgeCount = edgeCount;
    return newEdgeCollection;
  }
} // Given two EdgeCollections, this function returns an object holding:
// onlyA: An array of edges, which only exists in A
// onlyB: An array of edges, which only exists in B

export function diffEdgeCollections(
  edgeCollectionA: EdgeCollection,
  edgeCollectionB: EdgeCollection,
): {
  onlyA: Array<Edge>;
  onlyB: Array<Edge>;
} {
  // Since inMap and outMap are symmetrical to each other, it suffices to only diff the outMaps
  const mapDiff = diffDiffableMaps(edgeCollectionA.outMap, edgeCollectionB.outMap);

  const getEdgesForNodes = (nodeIds: number[], diffableMap: EdgeMap) =>
    _.flatten(nodeIds.map((nodeId) => diffableMap.getOrThrow(nodeId)));

  const edgeDiff = {
    onlyA: getEdgesForNodes(mapDiff.onlyA, edgeCollectionA.outMap),
    onlyB: getEdgesForNodes(mapDiff.onlyB, edgeCollectionB.outMap),
  };

  for (const changedNodeIndex of mapDiff.changed) {
    // For each changedNodeIndex there is at least one outgoing edge which was added or removed.
    // So, check for each outgoing edge whether it only exists in A or B
    const outgoingEdgesDiff = Utils.diffArrays(
      edgeCollectionA.outMap.getOrThrow(changedNodeIndex),
      edgeCollectionB.outMap.getOrThrow(changedNodeIndex),
    );
    edgeDiff.onlyA = edgeDiff.onlyA.concat(outgoingEdgesDiff.onlyA);
    edgeDiff.onlyB = edgeDiff.onlyB.concat(outgoingEdgesDiff.onlyB);
  }

  return edgeDiff;
}
