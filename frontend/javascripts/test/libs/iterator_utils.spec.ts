import { describe, it, expect } from "vitest";
import { max, min, maxBy, minBy, sum } from "viewer/model/helpers/iterator_utils";

// Helper function to create test number values
function createNumberMap(): Map<number, number> {
  return new Map([
    [1, 1],
    [2, 5],
    [3, 2],
    [4, 8],
    [5, 3],
  ]);
}

// Helper function to create test negative number values
function createNegativeNumberMap(): Map<number, number> {
  return new Map([
    [1, -10],
    [2, -5],
    [3, -20],
    [4, -1],
  ]);
}

// Helper function to create test objects
function createObjectMap() {
  return new Map([
    [1, { id: 1, value: 10 }],
    [2, { id: 2, value: 5 }],
    [3, { id: 3, value: 15 }],
    [4, { id: 4, value: 8 }],
  ]);
}

describe("Iterator Utils", () => {
  describe("max", () => {
    it("should return the maximum value in an array", () => {
      const map = createNumberMap();
      expect(max(map.values())).toBe(8);
    });

    it("should return null for an empty array", () => {
      const map = new Map<number, number>();
      expect(max(map.values())).toBeNull();
    });

    it("should handle negative numbers", () => {
      const map = createNegativeNumberMap();
      expect(max(map.values())).toBe(-1);
    });
  });

  describe("min", () => {
    it("should return the minimum value in an array", () => {
      const map = createNumberMap();
      expect(min(map.values())).toBe(1);
    });

    it("should return null for an empty array", () => {
      const map = new Map<number, number>();
      expect(min(map.values())).toBeNull();
    });

    it("should handle negative numbers", () => {
      const map = createNegativeNumberMap();
      expect(min(map.values())).toBe(-20);
    });
  });

  describe("maxBy", () => {
    it("should find the object with maximum value using a selector function", () => {
      const objects = createObjectMap();
      const result = maxBy(objects.values(), (obj) => obj.value);
      expect(result).toEqual({ id: 3, value: 15 });
    });

    it("should find the object with maximum value using a property name", () => {
      const objects = createObjectMap();
      const result = maxBy(objects.values(), "value");
      expect(result).toEqual({ id: 3, value: 15 });
    });

    it("should return undefined for an empty collection", () => {
      const empty = new Map().values();
      expect(maxBy(empty, (obj) => obj.value)).toBeUndefined();
      expect(maxBy(empty, "value")).toBeUndefined();
    });

    it("should handle ID properties", () => {
      const objects = createObjectMap();
      const result = maxBy(objects.values(), "id");
      expect(result).toEqual({ id: 4, value: 8 });
    });
  });

  describe("minBy", () => {
    it("should find the object with minimum value using a selector function", () => {
      const objects = createObjectMap();
      const result = minBy(objects.values(), (obj) => obj.value);
      expect(result).toEqual({ id: 2, value: 5 });
    });

    it("should find the object with minimum value using a property name", () => {
      const objects = createObjectMap();
      const result = minBy(objects.values(), "value");
      expect(result).toEqual({ id: 2, value: 5 });
    });

    it("should return undefined for an empty collection", () => {
      const empty = new Map().values();
      expect(minBy(empty, (obj) => obj.value)).toBeUndefined();
      expect(minBy(empty, "value")).toBeUndefined();
    });

    it("should handle ID properties", () => {
      const objects = createObjectMap();
      const result = minBy(objects.values(), "id");
      expect(result).toEqual({ id: 1, value: 10 });
    });
  });

  describe("sum", () => {
    it("should return the sum of all values in an array", () => {
      const map = createNumberMap();
      expect(sum(map.values())).toBe(19); // 1 + 5 + 2 + 8 + 3 = 19
    });

    it("should return 0 for an empty array", () => {
      const map = new Map<number, number>();
      expect(sum(map.values())).toBe(0);
    });

    it("should handle negative numbers", () => {
      const map = createNegativeNumberMap();
      expect(sum(map.values())).toBe(-36); // -10 + -5 + -20 + -1 = -36
    });
  });
});
