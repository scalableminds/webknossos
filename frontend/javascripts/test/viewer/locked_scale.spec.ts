import { applyLockedScaleChange } from "viewer/view/left_border_tabs/components/locked_scale";
import { MIN_SCALE } from "viewer/view/left_border_tabs/components/relative_slider";
import { describe, expect, it } from "vitest";

describe("applyLockedScaleChange", () => {
  it("should keep the proportions between the locked axes", () => {
    expect(applyLockedScaleChange([1, 2, 4], [true, true, true], 0, 2)).toEqual([2, 4, 8]);
    expect(applyLockedScaleChange([1, 2, 4], [true, true, true], 2, 1)).toEqual([0.25, 0.5, 1]);
  });

  it("should only change the given axis if it is unlocked", () => {
    expect(applyLockedScaleChange([1, 2, 4], [false, true, true], 0, 3)).toEqual([3, 2, 4]);
  });

  it("should leave unlocked axes untouched when a locked axis changes", () => {
    expect(applyLockedScaleChange([1, 2, 4], [true, false, true], 0, 2)).toEqual([2, 2, 8]);
  });

  it("should keep exactly the same value for axes that were equal to the changed one", () => {
    // 1.23456 has more than the four significant digits that derived values are rounded to.
    expect(applyLockedScaleChange([3, 3, 6], [true, true, true], 1, 1.23456)).toEqual([
      1.23456, 1.23456, 2.469,
    ]);
  });

  it("should not let derived values drop below MIN_SCALE", () => {
    expect(applyLockedScaleChange([1, 0.001, 1], [true, true, true], 0, 0.01)).toEqual([
      0.01,
      MIN_SCALE,
      0.01,
    ]);
  });

  it("should set the locked axes to the same value when the changed axis was zero", () => {
    expect(applyLockedScaleChange([0, 2, 4], [true, true, true], 0, 0.5)).toEqual([0.5, 0.5, 0.5]);
  });
});
