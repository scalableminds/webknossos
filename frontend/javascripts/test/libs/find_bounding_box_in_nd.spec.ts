import { collectLabelBoundingBoxes } from "libs/find_bounding_box_in_nd";
import ndarray from "ndarray";
import { describe, expect, it } from "vitest";

/*
 * Builds a [width, height, 1] label map from a picture, one string per v (row), one character per
 * u (column), so the fixtures stay readable. "." is background; digits are instance ids. Ids above
 * 9 need `rawLabelMap` instead, since a cell is a single character.
 */
function labelMap(rows: string[]) {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8Array(width * height);
  rows.forEach((row, v) => {
    for (let u = 0; u < width; u++) {
      const char = row[u];
      data[u * height + v] = char === "." ? 0 : Number.parseInt(char, 10);
    }
  });
  return ndarray(data, [width, height, 1], [height, 1, 1]);
}

function rawLabelMap(values: number[], width: number, height: number) {
  return ndarray(new Uint8Array(values), [width, height, 1], [height, 1, 1]);
}

describe("collectLabelBoundingBoxes", () => {
  it("returns nothing for an all-background map", () => {
    expect(collectLabelBoundingBoxes(labelMap(["....", "...."])).size).toBe(0);
  });

  it("finds one box per label, with exclusive maxima", () => {
    const boxes = collectLabelBoundingBoxes(labelMap([".11..", ".11..", "....2", "....2"]));
    expect([...boxes.keys()].sort()).toEqual([1, 2]);
    expect(boxes.get(1)).toEqual({ min: [1, 0], max: [3, 2] });
    expect(boxes.get(2)).toEqual({ min: [4, 2], max: [5, 4] });
  });

  it("covers disconnected pieces of the same instance", () => {
    // The detector may return one instance split across the slice; the box has to span both parts.
    const boxes = collectLabelBoundingBoxes(labelMap(["3...3", "....."]));
    expect(boxes.get(3)).toEqual({ min: [0, 0], max: [5, 1] });
  });

  it("keeps instances apart when they interleave", () => {
    const boxes = collectLabelBoundingBoxes(labelMap(["1.2.1", "1.2.1"]));
    expect(boxes.get(1)).toEqual({ min: [0, 0], max: [5, 2] });
    expect(boxes.get(2)).toEqual({ min: [2, 0], max: [3, 2] });
  });

  it("handles the highest instance id the model can return", () => {
    // SAM 3.1 tracks at most 16 objects, so id 16 has to survive the scan unchanged.
    const boxes = collectLabelBoundingBoxes(rawLabelMap([16, 0, 0, 16], 2, 2));
    expect(boxes.get(16)).toEqual({ min: [0, 0], max: [2, 2] });
  });
});
