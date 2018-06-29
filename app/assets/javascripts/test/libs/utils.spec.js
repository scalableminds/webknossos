// @flow

import test from "ava";
import Utils from "libs/utils";

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
