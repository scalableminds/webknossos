import { describe, it, expect } from "vitest";
import EdgeCollection, { diffEdgeCollections } from "../../viewer/model/edge_collection";
import type { Edge } from "viewer/model/types/tree_types";

const edgeSort = (edgeA: Edge, edgeB: Edge) => {
  if (edgeA.source !== edgeB.source) return edgeA.source - edgeB.source;
  return edgeA.target - edgeB.target;
};

describe("EdgeCollection", () => {
  it("should have symmetrical inMap and outMap", () => {
    const edgeA = {
      source: 0,
      target: 1,
    };
    const edgeB = {
      source: 2,
      target: 1,
    };
    const edgeC = {
      source: 3,
      target: 2,
    };
    const edgeD = {
      source: 3,
      target: 4,
    };
    const edgeCollection = new EdgeCollection()
      .addEdges([edgeA, edgeB, edgeC, edgeD])
      .removeEdge(edgeD);
    expect(edgeCollection.size()).toBe(3);
    expect(edgeCollection.outMap.size()).toBe(3);
    expect(edgeCollection.inMap.size()).toBe(2);
    expect(edgeCollection.outMap.getOrThrow(0)).toEqual([edgeA]);
    expect(edgeCollection.outMap.has(1)).toBe(false);
    expect(edgeCollection.outMap.getOrThrow(2)).toEqual([edgeB]);
    expect(edgeCollection.outMap.getOrThrow(3)).toEqual([edgeC]);
    expect(edgeCollection.inMap.has(0)).toBe(false);
    expect(edgeCollection.inMap.getOrThrow(1)).toEqual([edgeA, edgeB]);
    expect(edgeCollection.inMap.getOrThrow(2)).toEqual([edgeC]);
    expect(edgeCollection.inMap.has(3)).toBe(false);
    expect(edgeCollection.getEdgesForNode(2)).toEqual([edgeB, edgeC]);
  });

  it("diffing should work when there is a diff", () => {
    const edgeA = {
      source: 0,
      target: 1,
    };
    const edgeB = {
      source: 2,
      target: 1,
    };
    const edgeC = {
      source: 3,
      target: 2,
    };
    const edgeD = {
      source: 3,
      target: 4,
    };
    const edgeCollectionA = new EdgeCollection().addEdges([edgeC, edgeD]);
    const edgeCollectionB = new EdgeCollection().addEdges([edgeA, edgeB, edgeC]);
    const { onlyA, onlyB } = diffEdgeCollections(edgeCollectionA, edgeCollectionB);
    expect(onlyA).toEqual([edgeD]);
    expect(onlyB).toEqual([edgeA, edgeB]);
  });

  it("diffing should work when there is no diff", () => {
    const edgeA = {
      source: 0,
      target: 1,
    };
    const edgeB = {
      source: 2,
      target: 1,
    };
    const edgeC = {
      source: 3,
      target: 2,
    };
    const edgeD = {
      source: 3,
      target: 4,
    };
    const edgeCollectionA = new EdgeCollection().addEdges([edgeA, edgeB, edgeC, edgeD]);
    const edgeCollectionB = new EdgeCollection().addEdges([edgeA, edgeB, edgeC, edgeD]);
    const { onlyA, onlyB } = diffEdgeCollections(edgeCollectionA, edgeCollectionB);
    expect(onlyA).toEqual([]);
    expect(onlyB).toEqual([]);
  });

  it("diffing should work with smaller batch size when there is no diff (1/2)", () => {
    const edges = [
      {
        source: 0,
        target: 1,
      },
      {
        source: 2,
        target: 1,
      },
      {
        source: 3,
        target: 2,
      },
      {
        source: 3,
        target: 4,
      },
      {
        source: 0,
        target: 1,
      },
      {
        source: 1,
        target: 6,
      },
      {
        source: 5,
        target: 7,
      },
      {
        source: 6,
        target: 3,
      },
      {
        source: 7,
        target: 8,
      },
      {
        source: 8,
        target: 9,
      },
      {
        source: 9,
        target: 10,
      },
      {
        source: 9,
        target: 11,
      },
    ];
    const edgeCollectionA = new EdgeCollection(5).addEdges(edges);
    const edgeCollectionB = new EdgeCollection(5).addEdges(edges);
    const { onlyA, onlyB } = diffEdgeCollections(edgeCollectionA, edgeCollectionB);
    expect(onlyA).toEqual([]);
    expect(onlyB).toEqual([]);
  });

  it("diffing should work with smaller batch size when there is a diff (2/2)", () => {
    const edges = [
      {
        source: 0,
        target: 1,
      },
      {
        source: 2,
        target: 1,
      },
      {
        source: 3,
        target: 2,
      },
      {
        source: 3,
        target: 4,
      },
      {
        source: 0,
        target: 1,
      },
      {
        source: 1,
        target: 6,
      },
      {
        source: 5,
        target: 7,
      },
      {
        source: 6,
        target: 3,
      },
      {
        source: 7,
        target: 8,
      },
      {
        source: 8,
        target: 9,
      },
      {
        source: 9,
        target: 10,
      },
      {
        source: 9,
        target: 11,
      },
    ].sort(edgeSort);
    const edgeCollectionA = new EdgeCollection(5).addEdges(edges.slice(0, 8));
    const edgeCollectionB = new EdgeCollection(5).addEdges(edges.slice(1));
    const { onlyA, onlyB } = diffEdgeCollections(edgeCollectionA, edgeCollectionB);
    expect(onlyA.sort(edgeSort)).toEqual([edges[0]]);
    expect(onlyB.sort(edgeSort)).toEqual(edges.slice(8));
  });

  it("addEdge should not mutate the original edge collection", () => {
    const edgeA = {
      source: 0,
      target: 1,
    };
    const edgeB = {
      source: 2,
      target: 1,
    };
    const edgeC = {
      source: 3,
      target: 2,
    };
    const edgeD = {
      source: 3,
      target: 4,
    };
    const edgeCollectionA = new EdgeCollection().addEdges([edgeA, edgeB, edgeC]);
    const edgeCollectionB = edgeCollectionA.addEdge(edgeD);
    const { onlyA, onlyB } = diffEdgeCollections(edgeCollectionA, edgeCollectionB);
    expect(onlyA).toEqual([]);
    expect(onlyB).toEqual([edgeD]);
  });

  it("addEdge should mutate the original edge collection if specified", () => {
    const edgeA = {
      source: 0,
      target: 1,
    };
    const edgeB = {
      source: 2,
      target: 1,
    };
    const edgeC = {
      source: 3,
      target: 2,
    };
    const edgeD = {
      source: 3,
      target: 4,
    };
    const edgeCollectionA = new EdgeCollection().addEdges([edgeA, edgeB, edgeC]);
    const edgeCollectionB = edgeCollectionA.addEdge(edgeD, true);
    const { onlyA, onlyB } = diffEdgeCollections(edgeCollectionA, edgeCollectionB);
    expect(onlyA).toEqual([]);
    expect(onlyB).toEqual([]);
  });
});
