import {
  niceStep,
  reanchorWindow,
  type SliderWindow,
} from "viewer/view/left_border_tabs/components/layer_transform_slider_scaling";
import { describe, expect, it } from "vitest";

function fractionOf(window: SliderWindow, value: number): number {
  return (value - window.min) / (window.max - window.min);
}

describe("niceStep", () => {
  it("should round to the nearest 1, 2 or 5 times a power of ten", () => {
    expect(niceStep(0.23)).toBeCloseTo(0.2, 10);
    expect(niceStep(0.4)).toBeCloseTo(0.5, 10);
    expect(niceStep(3)).toBe(2);
    expect(niceStep(7)).toBe(5);
    expect(niceStep(12)).toBe(10);
    expect(niceStep(1)).toBe(1);
  });

  it("should never return zero or a negative step", () => {
    for (const rawStep of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 1e-12]) {
      expect(niceStep(rawStep)).toBeGreaterThan(0);
    }
  });

  it("should scale across magnitudes", () => {
    expect(niceStep(0.011)).toBeCloseTo(0.01, 10);
    expect(niceStep(430)).toBe(500);
    expect(niceStep(21000)).toBe(20000);
  });
});

describe("reanchorWindow", () => {
  it("should center the value when there is no previous window", () => {
    const window = reanchorWindow(null, 100, 400, 1);

    expect(window).toEqual({ min: -100, max: 300 });
    expect(fractionOf(window, 100)).toBeCloseTo(0.5, 10);
  });

  it("should keep the handle at the same relative position when widening", () => {
    const previous = { min: 0, max: 100 };
    const value = 90; // at 90% of the previous window

    const widened = reanchorWindow(previous, value, 1000, 0.001);

    expect(fractionOf(widened, value)).toBeCloseTo(0.9, 6);
    expect(widened.max - widened.min).toBeCloseTo(1000, 10);
  });

  it("should keep the handle at the same relative position when narrowing", () => {
    const previous = { min: 0, max: 1000 };
    const value = 900; // again 90%

    const narrowed = reanchorWindow(previous, value, 50, 0.001);

    expect(fractionOf(narrowed, value)).toBeCloseTo(0.9, 6);
    expect(narrowed.max - narrowed.min).toBeCloseTo(50, 10);
  });

  it("should always contain the value, including at the window's edges", () => {
    const previous = { min: -10, max: 10 };

    for (const value of [-10, -3.7, 0, 4.2, 10]) {
      for (const width of [0.5, 7, 250, 1e5]) {
        const window = reanchorWindow(previous, value, width, 0.1);

        expect(value).toBeGreaterThanOrEqual(window.min);
        expect(value).toBeLessThanOrEqual(window.max);
      }
    }
  });

  it("should keep the requested width", () => {
    for (const width of [0.001, 1, 376, 12345.6]) {
      const window = reanchorWindow({ min: 0, max: 10 }, 5, width, 0.01);

      expect(window.max - window.min).toBeCloseTo(width, 6);
    }
  });

  it("should snap the window start to a multiple of the step", () => {
    const window = reanchorWindow(null, 100, 400, 10);

    expect(window.min % 10).toBeCloseTo(0, 10);
  });

  it("should fall back to a usable window for a degenerate width", () => {
    const window = reanchorWindow(null, 5, 0, 0.25);

    expect(window.max).toBeGreaterThan(window.min);
    expect(5).toBeGreaterThanOrEqual(window.min);
    expect(5).toBeLessThanOrEqual(window.max);
  });

  it("should not move the window when width and value are unchanged", () => {
    const previous = { min: -188, max: 188 };
    const value = 42;

    const again = reanchorWindow(previous, value, previous.max - previous.min, 1);

    expect(again.min).toBeCloseTo(previous.min, 6);
    expect(again.max).toBeCloseTo(previous.max, 6);
  });
});
