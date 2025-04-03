import * as Utils from "libs/utils";
import { describe, it, expect } from "vitest";

describe("Utils", () => {
  it("filterWithSearchQueryAND: simple case", () => {
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
    expect(matchedElements.length).toBe(2);
    expect(matchedElements).toEqual(collection.slice(0, 2));
  });

  it("filterWithSearchQueryAND: complex case", () => {
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
    expect(matchedElements.length).toBe(1);
    expect(matchedElements).toEqual([collection[2]]);
  });

  it("filterWithSearchQueryAND: deep case different data types", () => {
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
    expect(matchedElements.length).toBe(1);
    expect(matchedElements).toEqual([collection[6]]);
  });

  it("chunkIntoTimeWindows 1/2", async () => {
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
    expect(chunks.length).toBe(2);
    expect(chunks).toEqual([chunk1, chunk2]);
  });

  it("chunkIntoTimeWindows 2/2", async () => {
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
    expect(chunks.length).toBe(3);
    expect(chunks).toEqual([chunk1, chunk2, chunk3]);
  });

  it("chunkDynamically (I)", () => {
    const elements = [5, 7, 10, 234, 10];
    const batches = Utils.chunkDynamically(elements, 10, (el) => el);
    expect(batches).toEqual([[5, 7], [10, 234], [10]]);
  });

  it("chunkDynamically (II)", () => {
    const elements = [5, 7, 10, 234, 10];
    const batches = Utils.chunkDynamically(elements, 100, (el) => el);
    expect(batches).toEqual([[5, 7, 10, 234], [10]]);
  });

  it("chunkDynamically (III)", () => {
    const elements = [5, 7, 10, 234, 10];
    const batches = Utils.chunkDynamically(elements, 1000, (el) => el);
    expect(batches).toEqual([[5, 7, 10, 234, 10]]);
  });

  it("chunkDynamically (IV)", () => {
    const elements = [5, 7, 10, 234, 10];
    const batches = Utils.chunkDynamically(elements, 1, (el) => el);
    expect(batches).toEqual([[5], [7], [10], [234], [10]]);
  });

  it("computeHash", () => {
    const hash1 = Utils.computeHash(
      "https://webknossos.org/datasets/demo_orga/demo_ds/view#2816,4352,1792,0,1.3",
    );
    const hash2 = Utils.computeHash(
      "https://webknossos.org/datasets/demo_orga/demo_ds/view#2816,4352,1792,0,1.4",
    );
    const hash3 = Utils.computeHash(
      "https://randomdomain.org/datasets/demo_orga/demo_ds/view#2816,4352,1792,0,1.3",
    );
    expect(hash1).not.toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash2).not.toBe(hash3);
  });

  it("encodeBase62", () => {
    const encoded = Utils.encodeToBase62(0);
    expect(encoded).toBe("0");
    const encoded2 = Utils.encodeToBase62(123);
    expect(encoded2).toBe("1z");
    const encoded3 = Utils.encodeToBase62(123456);
    expect(encoded3).toBe("W7E");
    const encoded4 = Utils.encodeToBase62(-1);
    expect(encoded4).toBe("z");
    const encoded5 = Utils.encodeToBase62(-2);
    expect(encoded5).toBe("y");
    const encoded6 = Utils.encodeToBase62(-123456);
    expect(encoded6).toBe("Tsm");
  });
});
