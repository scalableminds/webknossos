import { computeIdenticonPattern } from "components/identicon";
import { describe, expect, it } from "vitest";

describe("computeIdenticonPattern", () => {
  it("should be deterministic", () => {
    const seed = "66f1a2b3c4d5e6f708192a3b";
    expect(computeIdenticonPattern(seed)).toEqual(computeIdenticonPattern(seed));
  });

  it("should yield different patterns for ids that differ in a single character", () => {
    const patternA = computeIdenticonPattern("66f1a2b3c4d5e6f708192a3b");
    const patternB = computeIdenticonPattern("66f1a2b3c4d5e6f708192a3c");
    expect(patternA.cells).not.toEqual(patternB.cells);
    expect(patternA.hue).not.toEqual(patternB.hue);
  });

  it("should be horizontally symmetric", () => {
    for (const seed of ["a", "annotation", "66f1a2b3c4d5e6f708192a3b"]) {
      for (const row of computeIdenticonPattern(seed).cells) {
        expect(row).toEqual([...row].reverse());
      }
    }
  });
});
