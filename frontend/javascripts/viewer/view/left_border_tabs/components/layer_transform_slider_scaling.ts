// Pure helpers that derive the step size and the visible range of the translation sliders in the
// layer transform popover from the current zoom. They live in their own module (free of React and
// antd imports) so that they can be unit tested without pulling in the whole popover.

// Smallest step a translation slider may use, so that the step can never become 0.
export const MIN_TRANSLATION_STEP = 0.0001;
const NICE_STEP_MANTISSAS = [1, 2, 5, 10];

// The visible range of a translation slider, in voxels. Unlike the scaling rows, the translation
// rows are not a symmetric interval around 0 but a window that follows the current zoom.
export type SliderWindow = { min: number; max: number };

// Rounds a raw step to the nearest 1, 2 or 5 times a power of ten, so that a slider steps in
// readable increments instead of e.g. 0.3179 voxels.
export function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) {
    return MIN_TRANSLATION_STEP;
  }
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const candidates = NICE_STEP_MANTISSAS.map((mantissa) => mantissa * magnitude);
  const nearest = candidates.reduce((best, candidate) =>
    Math.abs(candidate - rawStep) < Math.abs(best - rawStep) ? candidate : best,
  );
  return Math.max(MIN_TRANSLATION_STEP, nearest);
}

// Returns a window of the given width that contains value. If a previous window is passed, the
// value keeps its relative position within the window, so that changing the width (because the user
// zoomed) does not make the slider handle jump. Without a previous window the value is centered.
export function reanchorWindow(
  previous: SliderWindow | null,
  value: number,
  width: number,
  step: number,
): SliderWindow {
  const safeWidth =
    Number.isFinite(width) && width > 0 ? width : Math.max(step, MIN_TRANSLATION_STEP);
  const previousWidth = previous != null ? previous.max - previous.min : 0;
  const fraction =
    previous != null && previousWidth > 0
      ? Math.min(1, Math.max(0, (value - previous.min) / previousWidth))
      : 0.5;
  const rawMin = value - fraction * safeWidth;
  // Snap to a multiple of the step so that the slider's values stay readable. This moves the handle
  // by at most one step, which is a fraction of a percent of the window's width.
  const snappedMin = step > 0 ? Math.round(rawMin / step) * step : rawMin;
  // Keep the value inside the window, which snapping could otherwise break at the very edges.
  const min = Math.min(Math.max(snappedMin, value - safeWidth), value);
  return { min, max: min + safeWidth };
}
