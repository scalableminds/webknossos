import { isMalformedList, parseValue } from "components/key_value_pairs_parser";
import { describe, expect, it } from "vitest";

describe("parseValue", () => {
  it("should coerce single values", () => {
    expect(parseValue("42")).toBe(42);
    expect(parseValue("-1.5")).toBe(-1.5);
    expect(parseValue("true")).toBe(true);
    expect(parseValue("false")).toBe(false);
    expect(parseValue("some text")).toBe("some text");
    expect(parseValue("")).toBe("");
  });

  it("should keep quoted values as strings", () => {
    expect(parseValue('"42"')).toBe("42");
    expect(parseValue("'true'")).toBe("true");
  });

  it("should parse comma-separated lists of values", () => {
    expect(parseValue("1, 34, 56")).toEqual([1, 34, 56]);
    expect(parseValue("a,b")).toEqual(["a", "b"]);
    expect(parseValue("true, 0.5, text")).toEqual([true, 0.5, "text"]);
    expect(parseValue(" 1 , 2 , ")).toEqual([1, 2]);
  });

  it("should parse bracketed lists of values", () => {
    expect(parseValue("[1, 2, 3]")).toEqual([1, 2, 3]);
    expect(parseValue("[a,b]")).toEqual(["a", "b"]);
    expect(parseValue("[]")).toEqual([]);
    expect(parseValue(" [ 1 , 2 , ] ")).toEqual([1, 2]);
  });

  it("should parse lists of value groups", () => {
    const twoGroups = [
      [0, 0, 0],
      [10, 10, 10],
    ];
    expect(parseValue("[0, 0, 0], [10, 10, 10]")).toEqual(twoGroups);
    expect(parseValue("[[0, 0, 0], [10, 10, 10]]")).toEqual(twoGroups);
    expect(parseValue("[[1]]")).toEqual([[1]]);
  });

  it("should not split commas within quoted tokens", () => {
    expect(parseValue('"a, b"')).toBe("a, b");
    expect(parseValue('"a, b", c')).toEqual(["a, b", "c"]);
    expect(parseValue('["a, b", c]')).toEqual(["a, b", "c"]);
  });

  it("should fall back to text for malformed or too deeply nested lists", () => {
    expect(parseValue("[1, 2")).toBe("[1, 2");
    expect(parseValue("[1, , 2]")).toBe("[1, , 2]");
    expect(parseValue("1, , 2")).toBe("1, , 2");
    expect(parseValue("[[[1]]]")).toBe("[[[1]]]");
    expect(parseValue("[1, 2]]")).toBe("[1, 2]]");
    expect(parseValue("[[0, 0], [1, 1]], [[2, 2]]")).toBe("[[0, 0], [1, 1]], [[2, 2]]");
  });
});

describe("isMalformedList", () => {
  it("should only flag values that look like a list but do not parse", () => {
    expect(isMalformedList("[1, 2")).toBe(true);
    expect(isMalformedList("[[[1]]]")).toBe(true);
    expect(isMalformedList("1, , 2")).toBe(true);
    expect(isMalformedList("[1, 2]")).toBe(false);
    expect(isMalformedList("1, 2")).toBe(false);
    expect(isMalformedList("42")).toBe(false);
    expect(isMalformedList("some [text]")).toBe(false);
    expect(isMalformedList('"a, b"')).toBe(false);
  });
});
