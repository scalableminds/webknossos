import test from "ava";
import * as Utils from "libs/utils";

test("filterWithSearchQueryAND: simple case", (t) => {
  const collection = [
    {
      prop: "match",
    },
    {
      prop: "a MATCH!",
    },
    {
      prop: "no m_tch",
    },
  ];
  const matchedElements = Utils.filterWithSearchQueryAND(collection, ["prop"], "match");
  t.is(matchedElements.length, 2);
  t.deepEqual(matchedElements, collection.slice(0, 2));
});
test("filterWithSearchQueryAND: complex case", (t) => {
  const collection = [
    {
      prop: "match",
      prop2: "",
    },
    {
      prop: "no m_tch!",
      prop2: "no m_tch",
    },
    {
      prop: "some match",
      prop2: "a keyword",
    },
  ];
  const matchedElements = Utils.filterWithSearchQueryAND(
    collection,
    ["prop", (el) => el.prop2],
    "match keyword",
  );
  t.is(matchedElements.length, 1);
  t.deepEqual(matchedElements, [collection[2]]);
});
test("filterWithSearchQueryAND: deep case different data types", (t) => {
  const collection = [
    {
      prop: {
        prop2: 7,
      },
    },
    {
      prop: {
        prop2: false,
      },
    },
    {
      prop: {
        prop2: null,
      },
    },
    {
      prop: {
        prop2: undefined,
      },
    },
    {
      prop: {
        prop2: "",
      },
    },
    {
      prop: {
        prop2: "no m_tch",
      },
    },
    {
      prop: {
        prop2: "a keyword",
      },
    },
  ];
  const matchedElements = Utils.filterWithSearchQueryAND(collection, ["prop"], "a key");
  t.is(matchedElements.length, 1);
  t.deepEqual(matchedElements, [collection[6]]);
});
test("chunkIntoTimeWindows 1/2", async (t) => {
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
  const chunks = Utils.chunkIntoTimeWindows(collection, (el) => el.time, 4);
  t.is(chunks.length, 2);
  t.deepEqual(chunks, [chunk1, chunk2]);
});
test("chunkIntoTimeWindows 2/2", async (t) => {
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
  const chunks = Utils.chunkIntoTimeWindows(collection, (el) => el.time, 9);
  t.is(chunks.length, 3);
  t.deepEqual(chunks, [chunk1, chunk2, chunk3]);
});

test("chunkDynamically (I)", (t) => {
  const elements = [5, 7, 10, 234, 10];
  const batches = Utils.chunkDynamically(elements, 10, (el) => el);
  t.deepEqual(batches, [[5, 7], [10, 234], [10]]);
});

test("chunkDynamically (II)", (t) => {
  const elements = [5, 7, 10, 234, 10];
  const batches = Utils.chunkDynamically(elements, 100, (el) => el);
  t.deepEqual(batches, [[5, 7, 10, 234], [10]]);
});

test("chunkDynamically (III)", (t) => {
  const elements = [5, 7, 10, 234, 10];
  const batches = Utils.chunkDynamically(elements, 1000, (el) => el);
  t.deepEqual(batches, [[5, 7, 10, 234, 10]]);
});

test("chunkDynamically (IV)", (t) => {
  const elements = [5, 7, 10, 234, 10];
  const batches = Utils.chunkDynamically(elements, 1, (el) => el);
  t.deepEqual(batches, [[5], [7], [10], [234], [10]]);
});

test("computeHash", (t) => {
  const hash1 = Utils.computeHash(
    "https://webknossos.org/datasets/demo_orga/demo_ds/view#2816,4352,1792,0,1.3",
  );
  const hash2 = Utils.computeHash(
    "https://webknossos.org/datasets/demo_orga/demo_ds/view#2816,4352,1792,0,1.4",
  );
  const hash3 = Utils.computeHash(
    "https://randomdomain.org/datasets/demo_orga/demo_ds/view#2816,4352,1792,0,1.3",
  );
  t.not(hash1, hash2);
  t.not(hash1, hash3);
  t.not(hash2, hash3);
});

test("encodeBase62", (t) => {
  const encoded = Utils.encodeToBase62(0);
  t.is(encoded, "0");
  const encoded2 = Utils.encodeToBase62(123);
  t.is(encoded2, "1z");
  const encoded3 = Utils.encodeToBase62(123456);
  t.is(encoded3, "W7E");
  const encoded4 = Utils.encodeToBase62(-1);
  t.is(encoded4, "z");
  const encoded5 = Utils.encodeToBase62(-2);
  t.is(encoded5, "y");
  const encoded6 = Utils.encodeToBase62(-123456);
  t.is(encoded6, "Tsm");
});
