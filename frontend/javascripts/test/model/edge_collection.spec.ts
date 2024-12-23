import test from "ava";
import EdgeCollection, { diffEdgeCollections } from "../../oxalis/model/edge_collection";

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'edgeA' implicitly has an 'any' type.
const edgeSort = (edgeA, edgeB) => {
  if (edgeA.source !== edgeB.source) return edgeA.source - edgeB.source;
  return edgeA.target - edgeB.target;
};

test("EdgeCollection should have symmetrical inMap and outMap", (t) => {
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
  t.is(edgeCollection.size(), 3);
  t.is(edgeCollection.outMap.size(), 3);
  t.is(edgeCollection.inMap.size(), 2);
  t.deepEqual(edgeCollection.outMap.getOrThrow(0), [edgeA]);
  t.false(edgeCollection.outMap.has(1));
  t.deepEqual(edgeCollection.outMap.getOrThrow(2), [edgeB]);
  t.deepEqual(edgeCollection.outMap.getOrThrow(3), [edgeC]);
  t.false(edgeCollection.inMap.has(0));
  t.deepEqual(edgeCollection.inMap.getOrThrow(1), [edgeA, edgeB]);
  t.deepEqual(edgeCollection.inMap.getOrThrow(2), [edgeC]);
  t.false(edgeCollection.inMap.has(3));
  t.deepEqual(edgeCollection.getEdgesForNode(2), [edgeB, edgeC]);
});
test("EdgeCollection diffing should work when there is a diff", (t) => {
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
  t.deepEqual(onlyA, [edgeD]);
  t.deepEqual(onlyB, [edgeA, edgeB]);
});
test("EdgeCollection diffing should work when there is no diff", (t) => {
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
  t.deepEqual(onlyA, []);
  t.deepEqual(onlyB, []);
});
test("EdgeCollection diffing should work with smaller batch size when there is no diff (1/2)", (t) => {
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
  t.deepEqual(onlyA, []);
  t.deepEqual(onlyB, []);
});
test("EdgeCollection diffing should work with smaller batch size when there is a diff (2/2)", (t) => {
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
  t.deepEqual(onlyA.sort(edgeSort), [edges[0]]);
  t.deepEqual(onlyB.sort(edgeSort), edges.slice(8));
});
test("EdgeCollection addEdge should not mutate the original edge collection", (t) => {
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
  t.deepEqual(onlyA, []);
  t.deepEqual(onlyB, [edgeD]);
});
test("EdgeCollection addEdge should mutate the original edge collection if specified", (t) => {
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
  t.deepEqual(onlyA, []);
  t.deepEqual(onlyB, []);
});
