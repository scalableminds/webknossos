// @flow
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import test from "ava";

import EdgeCollection from "../../oxalis/model/edge_collection";

test("EdgeCollection should have symmetrical inMap and outMap", t => {
  const edgeA = { source: 0, target: 1 };
  const edgeB = { source: 2, target: 1 };
  const edgeC = { source: 3, target: 2 };
  const edgeD = { source: 3, target: 4 };

  const edgeCollection = new EdgeCollection()
    .addEdges([edgeA, edgeB, edgeC, edgeD])
    .removeEdge(edgeD);

  t.is(edgeCollection.size(), 3);
  t.is(edgeCollection.outMap.size(), 3);
  t.is(edgeCollection.inMap.size(), 2);

  t.deepEqual(edgeCollection.outMap.get(0), [edgeA]);
  t.false(edgeCollection.outMap.has(1));
  t.deepEqual(edgeCollection.outMap.get(2), [edgeB]);
  t.deepEqual(edgeCollection.outMap.get(3), [edgeC]);

  t.false(edgeCollection.inMap.has(0));
  t.deepEqual(edgeCollection.inMap.get(1), [edgeA, edgeB]);
  t.deepEqual(edgeCollection.inMap.get(2), [edgeC]);
  t.false(edgeCollection.inMap.has(3));

  t.deepEqual(edgeCollection.getEdgesForNode(2), [edgeB, edgeC]);
});
