// @flow

import * as Utils from "libs/utils";
import test from "ava";

test("filterWithSearchQueryOR: simple case", t => {
  const collection = [{ prop: "match" }, { prop: "a MATCH!" }, { prop: "no m_tch" }];
  const matchedElements = Utils.filterWithSearchQueryOR(collection, ["prop"], "match");
  t.is(matchedElements.length, 2);
  t.deepEqual(matchedElements, collection.slice(0, 2));
});

test("filterWithSearchQueryOR: complex case", t => {
  const collection = [
    { prop: "match", prop2: "" },
    { prop: "no m_tch!", prop2: "no m_tch" },
    { prop: "no m_tch", prop2: "a keyword" },
  ];
  const matchedElements = Utils.filterWithSearchQueryOR(
    collection,
    ["prop", el => el.prop2],
    "match keyword",
  );
  t.is(matchedElements.length, 2);
  t.deepEqual(matchedElements, [collection[0], collection[2]]);
});

test("filterWithSearchQueryOR: deep case different data types", t => {
  const collection = [
    { prop: { prop2: 7 } },
    { prop: { prop2: false } },
    { prop: { prop2: null } },
    { prop: { prop2: undefined } },
    { prop: { prop2: "" } },
    { prop: { prop2: "no m_tch" } },
    { prop: { prop2: "a keyword" } },
  ];
  const matchedElements = Utils.filterWithSearchQueryOR(collection, ["prop"], "a key");
  t.is(matchedElements.length, 2);
  t.deepEqual(matchedElements, [collection[1], collection[6]]);
});

test("filterWithSearchQueryAND: simple case", t => {
  const collection = [{ prop: "match" }, { prop: "a MATCH!" }, { prop: "no m_tch" }];
  const matchedElements = Utils.filterWithSearchQueryAND(collection, ["prop"], "match");
  t.is(matchedElements.length, 2);
  t.deepEqual(matchedElements, collection.slice(0, 2));
});

test("filterWithSearchQueryAND: complex case", t => {
  const collection = [
    { prop: "match", prop2: "" },
    { prop: "no m_tch!", prop2: "no m_tch" },
    { prop: "some match", prop2: "a keyword" },
  ];
  const matchedElements = Utils.filterWithSearchQueryAND(
    collection,
    ["prop", el => el.prop2],
    "match keyword",
  );
  t.is(matchedElements.length, 1);
  t.deepEqual(matchedElements, [collection[2]]);
});

test("filterWithSearchQueryAND: deep case different data types", t => {
  const collection = [
    { prop: { prop2: 7 } },
    { prop: { prop2: false } },
    { prop: { prop2: null } },
    { prop: { prop2: undefined } },
    { prop: { prop2: "" } },
    { prop: { prop2: "no m_tch" } },
    { prop: { prop2: "a keyword" } },
  ];
  const matchedElements = Utils.filterWithSearchQueryAND(collection, ["prop"], "a key");
  t.is(matchedElements.length, 1);
  t.deepEqual(matchedElements, [collection[6]]);
});

test("chunkIntoTimeWindows 1/2", async t => {
  const chunk1 = [
    {
      time: 10 * 60 * 1000,
      id: "element1",
    },
  ];
  const chunk2 = [
    {
      time: 15 * 60 * 1000,
      id: "element2",
    },
    {
      time: 16 * 60 * 1000,
      id: "element3",
    },
    {
      time: 18 * 60 * 1000,
      id: "element4",
    },
  ];

  const collection = [...chunk1, ...chunk2];
  const chunks = Utils.chunkIntoTimeWindows(collection, el => el.time, 4);
  t.is(chunks.length, 2);
  t.deepEqual(chunks, [chunk1, chunk2]);
});

test("chunkIntoTimeWindows 2/2", async t => {
  const chunk1 = [
    {
      time: 0 * 60 * 1000,
      id: "element1",
    },
  ];
  const chunk2 = [
    {
      time: 10 * 60 * 1000,
      id: "element2",
    },
    {
      time: 10 * 60 * 1000,
      id: "element3",
    },
    {
      time: 18 * 60 * 1000,
      id: "element4",
    },
  ];
  const chunk3 = [
    {
      time: 127 * 60 * 1000,
      id: "element5",
    },
    {
      time: 134 * 60 * 1000,
      id: "element6",
    },
    {
      time: 135 * 60 * 1000,
      id: "element7",
    },
  ];

  const collection = [...chunk1, ...chunk2, ...chunk3];
  const chunks = Utils.chunkIntoTimeWindows(collection, el => el.time, 9);
  t.is(chunks.length, 3);
  t.deepEqual(chunks, [chunk1, chunk2, chunk3]);
});
