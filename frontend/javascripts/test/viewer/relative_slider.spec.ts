import {
  applyRelativeDelta,
  applyRelativeFactor,
  FALLBACK_SLIDER_RANGE,
  formatSliderRange,
  getTranslationSliderConfig,
  MIN_SCALE,
  SCALE_SLIDER_CONFIG,
  sanitizeSliderRange,
} from "viewer/view/left_border_tabs/components/relative_slider";
import { describe, expect, it } from "vitest";

describe("sanitizeSliderRange", () => {
  it("should round a viewport extent to a single significant digit", () => {
    expect(sanitizeSliderRange(1253)).toBe(1000);
    expect(sanitizeSliderRange(2600)).toBe(3000);
    expect(sanitizeSliderRange(123.4)).toBe(100);
    expect(sanitizeSliderRange(9)).toBe(9);
  });

  it("should stay in the single-digit range when the mantissa rounds up", () => {
    expect(sanitizeSliderRange(9700)).toBe(10000);
  });

  it("should fall back for extents that no laid-out viewport can produce", () => {
    // getViewportExtentInVoxelPerAxis floors its result at 1, so 1 means "no viewport yet".
    for (const extent of [1, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sanitizeSliderRange(extent)).toBe(FALLBACK_SLIDER_RANGE);
    }
  });

  it("should always return a usable range with a single significant digit", () => {
    for (const extent of [2, 3.7, 47, 1000, 12345, 1e7, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const range = sanitizeSliderRange(extent);
      expect(Number.isInteger(range)).toBe(true);
      expect(range).toBeGreaterThan(1);
      // A single significant digit means the value is one digit followed by only zeroes.
      expect(range.toString().replace(/0+$/, "")).toHaveLength(1);
    }
  });
});

describe("formatSliderRange", () => {
  it("should spell out small ranges", () => {
    expect(formatSliderRange(9)).toBe("9");
    expect(formatSliderRange(100)).toBe("100");
    expect(formatSliderRange(900)).toBe("900");
  });

  it("should use an exponent instead of a thousands separator", () => {
    expect(formatSliderRange(1000)).toBe("1e3");
    expect(formatSliderRange(3000)).toBe("3e3");
    expect(formatSliderRange(9000)).toBe("9e3");
    expect(formatSliderRange(20000)).toBe("2e4");
    expect(formatSliderRange(1e7)).toBe("1e7");
  });

  it("should never contain a separator that reads like a decimal point", () => {
    for (const extent of [2, 47, 1253, 9700, 123456, 1e9]) {
      expect(formatSliderRange(sanitizeSliderRange(extent))).not.toMatch(/[.,]/);
    }
  });
});

describe("getTranslationSliderConfig", () => {
  it("should reach one viewport extent in either direction, in whole voxels", () => {
    const config = getTranslationSliderConfig(1253);

    expect(config.range).toBe(1000);
    expect(config.step).toBe(1);
    expect(config.apply(500, -200)).toBe(300);
  });

  it("should label both ends with the reachable decrease and increase", () => {
    const { marks } = getTranslationSliderConfig(1000);

    expect(
      Object.keys(marks)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([-1000, 1000]);
    expect(marks[-1000].label).toBe("-1e3");
    expect(marks[1000].label).toBe("+1e3");
  });

  it("should align the two labels differently, so that they stay inside the rail", () => {
    const { marks } = getTranslationSliderConfig(60);

    expect(marks[-60].style.transform).not.toBe(marks[60].style.transform);
    expect(marks[-60].style.fontSize).toBe(marks[60].style.fontSize);
  });

  it("should sign the offsets it shows in the tooltip", () => {
    const { formatOffset } = getTranslationSliderConfig(100);

    expect(formatOffset(25)).toBe("+25");
    expect(formatOffset(-25)).toBe("-25");
  });
});

describe("SCALE_SLIDER_CONFIG", () => {
  it("should span one decade in either direction", () => {
    expect(SCALE_SLIDER_CONFIG.range).toBe(1);
    expect(SCALE_SLIDER_CONFIG.marks[-1].label).toBe("×1/10");
    expect(SCALE_SLIDER_CONFIG.marks[1].label).toBe("×10");
  });

  it("should reach a tenth and ten times the value the action started from", () => {
    const { apply, range } = SCALE_SLIDER_CONFIG;

    expect(apply(2, -range)).toBe(0.2);
    expect(apply(2, range)).toBe(20);
    expect(apply(2, 0)).toBe(2);
  });

  it("should be logarithmic, i.e. equal distances are equal factors", () => {
    const { apply } = SCALE_SLIDER_CONFIG;

    // Half the rail in either direction is the same factor up as down. The tolerance is the four
    // significant digits that apply keeps.
    expect(apply(1, 0.5) * apply(1, -0.5)).toBeCloseTo(1, 3);
    // Two steps of 0.25 are one step of 0.5.
    expect(apply(apply(1, 0.25), 0.25)).toBeCloseTo(apply(1, 0.5), 3);
  });

  it("should describe the factor in the tooltip", () => {
    const { formatOffset } = SCALE_SLIDER_CONFIG;

    expect(formatOffset(0)).toBe("×1");
    expect(formatOffset(1)).toBe("×10");
    expect(formatOffset(-1)).toBe("×0.1");
  });
});

describe("applyRelativeFactor", () => {
  it("should scale relative to the base value", () => {
    expect(applyRelativeFactor(4, 0)).toBe(4);
    expect(applyRelativeFactor(4, 1)).toBe(40);
    expect(applyRelativeFactor(0.5, -1)).toBe(0.05);
  });

  it("should keep four significant digits, so that tiny scalings stay usable", () => {
    expect(applyRelativeFactor(0.001, 0.1)).toBeCloseTo(0.001259, 6);
  });

  it("should ignore the sign of the base, since the row shows only the magnitude", () => {
    expect(applyRelativeFactor(-4, 1)).toBe(40);
  });

  it("should never go below the smallest usable scaling", () => {
    expect(applyRelativeFactor(MIN_SCALE, -1)).toBe(MIN_SCALE);
  });

  it("should lift a degenerate base out of zero instead of staying stuck", () => {
    expect(applyRelativeFactor(0, 1)).toBeGreaterThan(0);
    expect(applyRelativeFactor(Number.NaN, 1)).toBeGreaterThan(0);
  });

  it("should leave the base untouched for a non-finite offset", () => {
    expect(applyRelativeFactor(3, Number.NaN)).toBe(3);
  });
});

describe("applyRelativeDelta", () => {
  it("should increase and decrease the base value", () => {
    expect(applyRelativeDelta(10, -3)).toBe(7);
    expect(applyRelativeDelta(10, 3)).toBe(13);
  });

  it("should keep float dust out of the result", () => {
    expect(applyRelativeDelta(0.1, 0.2)).toBe(0.3);
  });

  it("should leave the base untouched for a zero delta", () => {
    expect(applyRelativeDelta(-12.5, 0)).toBe(-12.5);
  });

  it("should fall back to the operand that is usable", () => {
    expect(applyRelativeDelta(Number.NaN, 5)).toBe(5);
    expect(applyRelativeDelta(5, Number.NaN)).toBe(5);
    expect(applyRelativeDelta(Number.NaN, Number.NaN)).toBe(0);
  });

  it("should never produce a non-finite value", () => {
    const values = [0, 1.5, -7, 1e6, Number.NaN, Number.POSITIVE_INFINITY];
    for (const base of values) {
      for (const delta of values) {
        expect(Number.isFinite(applyRelativeDelta(base, delta))).toBe(true);
      }
    }
  });
});
