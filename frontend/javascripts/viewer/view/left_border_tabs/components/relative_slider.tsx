import { Slider } from "antd";
import { type CSSProperties, useCallback, useLayoutEffect, useRef, useState } from "react";

// Used when translation slider range cannot be inferred, e.g. because the
// viewport extent it should be inferred from does not exist because the viewport
// is currently not rendered.
export const FALLBACK_TRANSLATION_SLIDER_RANGE = 100;

// Translations are always applied in whole voxels, by the slider as well as by the number input next
// to it. The rail is only about a hundred pixels wide, so a step of one voxel is finer than the
// pointer can resolve and never quantizes a drag.
export const TRANSLATION_SLIDER_STEP = 1;

// The smallest scaling that can be reached, by the scale slider as well as by the scale number input.
export const MIN_SCALE = 0.0001;

// The scaling slider works in log10 space, so that shrinking and enlarging a layer are symmetric
// gestures: one decade in either direction, i.e. a tenth of the current size up to ten times it.
const SCALE_SLIDER_RANGE = 1;
// About 2.3% per step, fine enough that a drag is not visibly quantized.
const SCALE_SLIDER_STEP = 0.01;

// Ranges from this value on are labeled with an exponent (2e4 instead of 4000), so that the labels stay short.
const MIN_EXPONENT_FOR_LABEL = 3;

const MARK_LABEL_STYLE: CSSProperties = { fontSize: 10, whiteSpace: "nowrap" };

// The mark labels are rendered below the rail. Antd reserves room for a full-size label there, which
// would make every row noticeably taller, so the smaller labels of this slider get their own margin.
const MARK_LABEL_MARGIN = 15;

export type SliderMarks = Record<number, { style: CSSProperties; label: string }>;

// Everything a RelativeSlider needs to turn its handle's position into a new value. Such a slider
// only ever applies a position to the value it started from, so the two configurations below differ
// in what applying means: adding voxels for a translation, multiplying for a scaling.
export type RelativeSliderConfig = {
  // The slider spans [-range, range] and its handle rests at 0.
  range: number;
  step: number;
  marks: SliderMarks;
  // how to turn its handle's position/offset into a new value (relative to the original base value)
  //  e.g. addition for the translation slider and multiplication for the scale slider
  apply: (base: number, offset: number) => number;
  // Describes a handle position in the slider's tooltip.
  formatOffset: (offset: number) => string;
};

// Splits a positive value into a single-digit mantissa and an exponent, i.e. mantissa * 10 ** exponent
// is the value rounded to a single significant digit.
function decomposeToSingleDigit(value: number): { mantissa: number; exponent: number } {
  const exponent = Math.floor(Math.log10(value));
  const mantissa = Math.round(value / 10 ** exponent);
  // Rounding up from 9.5 leaves the single-digit range, as can an imprecise logarithm.
  return mantissa >= 10 ? { mantissa: 1, exponent: exponent + 1 } : { mantissa, exponent };
}

// Turns a viewport extent into a usable slider range, rounded to a single significant digit (e.g.
// 1253 becomes 1000) so that the largest increase/decrease one slider action can apply is a round
// number (round numbers are easier to display as slider labels).
export function translationSliderRangeFromViewportExtent(extentInVoxel: number): number {
  // getViewportExtentInVoxelPerAxis floors its result at 1 when a viewport has a zero-sized rect, so
  // an extent of 1 means "no laid-out ortho viewport" rather than a genuinely one-voxel-wide viewport.
  // So we use a fallback in that case.
  if (!Number.isFinite(extentInVoxel) || extentInVoxel <= 1) {
    return FALLBACK_TRANSLATION_SLIDER_RANGE;
  }
  const { mantissa, exponent } = decomposeToSingleDigit(extentInVoxel);
  return mantissa * 10 ** exponent;
}

// Formats a slider's range min/max to be shown as label.
// Large values are written in scientific notation (e.g. 2e4 instead of 40000)
// since this makes them easier to display/read with the limited space available.
export function formatSliderRange(range: number): string {
  const { mantissa, exponent } = decomposeToSingleDigit(range);
  return exponent >= MIN_EXPONENT_FOR_LABEL ? `${mantissa}e${exponent}` : String(range);
}

// Labels the two ends of a slider with what one slider action can apply there. The default mark style
// centers the label on the mark, which would push the outermost labels beyond the rail, so their
// outer edge is aligned with the rail's end instead.
function buildMarks(range: number, minLabel: string, maxLabel: string): SliderMarks {
  return {
    [-range]: {
      style: { ...MARK_LABEL_STYLE, transform: "translateX(0)" },
      label: minLabel,
    },
    [range]: {
      style: { ...MARK_LABEL_STYLE, transform: "translateX(-100%)" },
      label: maxLabel,
    },
  };
}

// Applies a slider offset to the value the current translation slider action started from.
// Rounding keeps the float dust of the summation out of the number input.
export function applyRelativeTranslationDelta(base: number, delta: number): number {
  if (!Number.isFinite(base)) {
    return Number.isFinite(delta) ? delta : 0;
  }
  if (!Number.isFinite(delta)) {
    return base;
  }
  return Math.round((base + delta) * 1e4) / 1e4;
}

// Multiplies the value the current slider action started from by 10 ** logOffset, so that equal
// distances on the rail are equal factors. The result keeps four significant digits, which stays
// meaningful for the very small scalings that MIN_SCALE allows.
export function applyRelativeFactor(base: number, logOffset: number): number {
  if (!Number.isFinite(logOffset)) {
    return base;
  }
  // A scaling of zero could not be enlarged again, so the slider acts on the smallest usable value.
  const safeBase = Number.isFinite(base) && base !== 0 ? Math.abs(base) : MIN_SCALE;
  return Math.max(MIN_SCALE, Number((safeBase * 10 ** logOffset).toPrecision(4)));
}

// The translation slider reaches one viewport extent in either direction, so the translation one
// slider action can apply follows the zoom level.
export function getTranslationSliderConfig(extentInVoxel: number): RelativeSliderConfig {
  const range = translationSliderRangeFromViewportExtent(extentInVoxel);
  const label = formatSliderRange(range);
  return {
    range,
    step: TRANSLATION_SLIDER_STEP,
    marks: buildMarks(range, `-${label}`, `+${label}`),
    apply: applyRelativeTranslationDelta,
    formatOffset: (offset) => (offset > 0 ? `+${offset}` : String(offset)),
  };
}

// The scaling slider reaches a tenth of the current size and ten times it. It is the same in every
// situation, so it does not have to be rebuilt.
export const SCALE_SLIDER_CONFIG: RelativeSliderConfig = {
  range: SCALE_SLIDER_RANGE,
  step: SCALE_SLIDER_STEP,
  marks: buildMarks(SCALE_SLIDER_RANGE, "×1/10", "×10"),
  apply: applyRelativeFactor,
  // e.g. "×0.25" or "×4".
  formatOffset: (logOffset) => `×${Number((10 ** logOffset).toPrecision(2))}`,
};

// A slider that does not show a value but changes it: its handle rests in the center and moving it
// applies an increment to the value, in the way its config describes. Releasing the handle moves it
// back to the center, so that the next action starts from the value that was just reached and the
// value itself is not limited by the slider's range.
export function RelativeSlider({
  value,
  config,
  onChange,
  ariaLabel,
}: {
  // The current value. Only read when a slider action starts.
  value: number;
  // How far the slider reaches and how a handle position turns into a new value.
  config: RelativeSliderConfig;
  // Called with the new value while the slider is being moved.
  onChange: (newValue: number) => void;
  ariaLabel?: string;
}) {
  const [offset, setOffset] = useState(0);
  // The config is kept stable while the slider is being moved, so that the rail cannot rescale under
  // the cursor when e.g. the user zooms mid-action.
  const [frozenConfig, setFrozenConfig] = useState<RelativeSliderConfig | null>(null);
  // The value the current action started from. This has to be a ref: onChange makes the caller
  // update the value prop, so reading the prop again during the same action would apply the offset
  // over and over.
  const baseRef = useRef<number | null>(null);
  const valueRef = useRef(value);
  // Synced after the commit rather than during render, so that a render React discards cannot make
  // the next action start from a value that was never committed.
  useLayoutEffect(() => {
    valueRef.current = value;
  }, [value]);

  const activeConfig = frozenConfig ?? config;

  const handleChange = (newOffset: number) => {
    if (baseRef.current == null) {
      baseRef.current = valueRef.current;
      setFrozenConfig(activeConfig);
    }
    setOffset(newOffset);
    onChange(activeConfig.apply(baseRef.current, newOffset));
  };

  const endAction = useCallback(() => {
    baseRef.current = null;
    setFrozenConfig(null);
    setOffset(0);
  }, []);

  return (
    // A new pointer gesture always starts from the current value. This also recovers from an action
    // that never received its mouseup, e.g. because the window lost focus while dragging.
    <div style={{ flex: 1 }} onPointerDown={endAction}>
      <Slider
        min={-activeConfig.range}
        max={activeConfig.range}
        step={activeConfig.step}
        value={offset}
        marks={activeConfig.marks}
        // There is no meaningful filled part of the rail for a handle that is always centered. The
        // dots that the marks add to the rail's ends stay, since they tie the labels to the rail.
        included={false}
        tooltip={{ formatter: (v) => (v == null ? "" : activeConfig.formatOffset(v)) }}
        ariaLabelForHandle={ariaLabel}
        onChange={handleChange}
        // The value has already been applied by the last onChange, so this only recenters the handle.
        onChangeComplete={endAction}
        style={{ marginBottom: MARK_LABEL_MARGIN }}
      />
    </div>
  );
}
