import { CloseOutlined } from "@ant-design/icons";
import { Alert, Flex, InputNumber, Spin, Typography } from "antd";
import FastTooltip from "components/fast_tooltip";
import { Slider } from "components/slider";
import { roundTo } from "libs/utils";
import debounce from "lodash-es/debounce";
import range from "lodash-es/range";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import type { APIHistogramData, ElementClass, HistogramDatum } from "types/api_types";
import { PRIMARY_COLOR, type Vector3 } from "viewer/constants";
import { getDataLayers } from "viewer/model/accessors/dataset_accessor";
import { updateLayerSettingAction } from "viewer/model/actions/settings_actions";
import Store, { type DatasetLayerConfiguration } from "viewer/store";

type HistogramProps = {
  data: APIHistogramData | null | undefined;
  layerName: string;
  intensityRangeMin: number;
  intensityRangeMax: number;
  min?: number;
  max?: number;
  isInEditMode: boolean;
  defaultMinMax: readonly [number, number];
  supportFractions: boolean;
  reloadHistogram: () => void;
};
// Range values typed into the inputs that are not committed (yet). They are tied to the
// props they were typed on, so that they are discarded once the committed range or the
// histogram data changes from elsewhere. A commit of this component rebases them onto
// the committed range instead.
type PendingRange = {
  min: number;
  max: number;
  basedOn: Pick<HistogramProps, "min" | "max" | "data">;
};

const uint24Colors = [
  [255, 65, 54],
  [46, 204, 64],
  [24, 144, 255],
] as Vector3[];
const CANVAS_HEIGHT = 100;
const CANVAS_WIDTH = 318;

export function isHistogramSupported(elementClass: ElementClass): boolean {
  // This function needs to be adapted when a new dtype should/element class needs
  // to be supported.
  // Note that histograms are only supported for color layers. This is why
  // (u)int64 is not listed here.
  return ["int8", "uint8", "int16", "uint16", "uint24", "uint32", "int32", "float"].includes(
    elementClass,
  );
}

function getMinAndMax(props: Pick<HistogramProps, "min" | "max" | "data" | "defaultMinMax">) {
  const { min, max, data, defaultMinMax } = props;

  if (min != null && max != null) {
    return {
      min,
      max,
    };
  }

  if (data == null) {
    return {
      min: defaultMinMax[0],
      max: defaultMinMax[1],
    };
  }

  const dataMin = Math.min(...data.map(({ min: minOfHistPart }) => minOfHistPart));
  const dataMax = Math.max(...data.map(({ max: maxOfHistPart }) => maxOfHistPart));
  return {
    min: dataMin,
    max: dataMax,
  };
}

function getPrecisionOf(num: number): number {
  const decimals = num.toString().split(".")[1];
  return decimals ? decimals.length : 0;
}

// A single sample of the histogram curve. x/y are in canvas coordinates
// (note that the canvas is flipped, see drawHistograms), whereas intensity is
// the data value the sample belongs to.
type CurvePoint = {
  x: number;
  y: number;
  intensity: number;
};

// Returns the y value of the curve at an arbitrary canvas x by linearly interpolating
// between the two enclosing samples. Since the samples are evenly spaced, the enclosing
// pair can be computed directly instead of searching for it.
function interpolateYAtCanvasX(points: CurvePoint[], canvasX: number): number {
  if (points.length < 2) {
    return points[0]?.y ?? 0;
  }
  const spacing = points[1].x - points[0].x;
  const exactIndex = spacing === 0 ? 0 : (canvasX - points[0].x) / spacing;
  const leftIndex = Math.max(0, Math.min(points.length - 2, Math.floor(exactIndex)));
  const fraction = Math.max(0, Math.min(1, exactIndex - leftIndex));
  return (1 - fraction) * points[leftIndex].y + fraction * points[leftIndex + 1].y;
}

const DUMMY_HISTOGRAM_DATA = [
  // Define a dummy histogram with a gaussian curve (mean=128 and std=30).
  // This is used as a fallback for a nicer look. On top of that, an error
  // message will be rendered.
  {
    elementCounts: range(255).map((idx) => Math.exp(-0.5 * ((idx - 128) / 30) ** 2)),
    min: 0,
    max: 255,
  },
];

function drawHistogram(
  ctx: CanvasRenderingContext2D,
  histogram: HistogramDatum,
  maxValue: number,
  color: Vector3,
  minRange: number,
  maxRange: number,
  intensityRangeMin: number,
  intensityRangeMax: number,
) {
  // Note that the canvas is flipped vertically (see drawHistograms), which is why
  // the y values below are used as-is (i.e., larger y means higher up).
  const { min: histogramMin, max: histogramMax, elementCounts } = histogram;
  const histogramLength = histogramMax - histogramMin;
  const fullLength = maxRange - minRange;
  if (!(fullLength > 0)) {
    // An empty (or invalid) range cannot be mapped onto the canvas width.
    return;
  }
  const xOffset = histogramMin - minRange;
  ctx.fillStyle = `rgba(${color.join(",")}, 0.1)`;
  ctx.strokeStyle = `rgba(${color.join(",")})`;

  const toCanvasX = (x: number) => (x / fullLength) * CANVAS_WIDTH;

  const points: CurvePoint[] = elementCounts.map((elementCount, index) => {
    const xInHistogramScale = (index * histogramLength) / elementCounts.length;
    return {
      x: toCanvasX(xOffset + xInHistogramScale),
      // Scale data to the height of the histogram canvas.
      y: (elementCount / maxValue) * CANVAS_HEIGHT,
      intensity: histogramMin + xInHistogramScale,
    };
  });
  if (points.length === 0) {
    return;
  }

  // Draw the curve itself.
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (const point of points) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();

  // Draw the highlighted "area under the curve" in the configured min/max range. Since the
  // range limits usually don't fall onto a sample, the curve is interpolated at both ends.
  const activeRegionLeftLimit = Math.max(histogramMin, intensityRangeMin) - minRange;
  const activeRegionRightLimit = Math.min(histogramMax, intensityRangeMax) - minRange;
  const activeRegionStartX = toCanvasX(activeRegionLeftLimit);
  const activeRegionEndX = toCanvasX(activeRegionRightLimit);
  if (activeRegionEndX <= activeRegionStartX) {
    // The configured range doesn't overlap with this histogram.
    return;
  }

  const activeRegion = new Path2D();
  activeRegion.moveTo(activeRegionStartX, 0);
  activeRegion.lineTo(activeRegionStartX, interpolateYAtCanvasX(points, activeRegionStartX));
  for (const point of points) {
    if (point.intensity >= intensityRangeMin && point.intensity <= intensityRangeMax) {
      activeRegion.lineTo(point.x, point.y);
    }
  }
  activeRegion.lineTo(activeRegionEndX, interpolateYAtCanvasX(points, activeRegionEndX));
  activeRegion.lineTo(activeRegionEndX, 0);
  activeRegion.closePath();
  ctx.fill(activeRegion);
}

function drawHistograms(
  canvas: HTMLCanvasElement,
  props: Pick<
    HistogramProps,
    "min" | "max" | "data" | "defaultMinMax" | "intensityRangeMin" | "intensityRangeMax"
  >,
) {
  const ctx = canvas.getContext("2d");
  if (ctx == null) {
    return;
  }
  // Flip the canvas vertically, so that y=0 is at the bottom.
  ctx.setTransform(1, 0, 0, -1, 0, CANVAS_HEIGHT);
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const { min, max } = props.data != null ? getMinAndMax(props) : DUMMY_HISTOGRAM_DATA[0];
  const data = props.data ?? DUMMY_HISTOGRAM_DATA;

  // Compute the overall maximum count, so the RGB curves are scaled correctly relative to each other.
  const maxValue = Math.max(
    ...data.map(({ elementCounts, min: histogramMin, max: histogramMax }) => {
      // We only take the elements of the array into account that are displayed.
      const displayedPartStartOffset = Math.max(histogramMin, min) - histogramMin;
      const displayedPartEndOffset = Math.min(histogramMax, max) - histogramMin;
      // Here we scale the offsets to the range of the elements array. The bounds are
      // rounded outwards, because the partially displayed buckets are drawn, too.
      const startingIndex = Math.floor(
        (displayedPartStartOffset * elementCounts.length) / (histogramMax - histogramMin),
      );
      const endingIndex = Math.ceil(
        (displayedPartEndOffset * elementCounts.length) / (histogramMax - histogramMin),
      );
      // Note that Math.max is not spread over the slice here, because the number of
      // buckets can exceed the maximum argument count.
      return elementCounts
        .slice(startingIndex, endingIndex + 1)
        .reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY);
    }),
  );

  for (const [i, histogram] of data.entries()) {
    const color = data.length > 1 ? uint24Colors[i] : PRIMARY_COLOR;
    drawHistogram(
      ctx,
      histogram,
      maxValue,
      color,
      min,
      max,
      props.intensityRangeMin,
      props.intensityRangeMax,
    );
  }
}

function shouldUseExponentialNotation(value: number) {
  return Math.abs(value) >= 100000 || (value < 0.001 && value > -0.001 && value !== 0);
}

function formatValue(value: number | undefined, precision: number) {
  if (value == null) {
    return "invalid";
  }
  return shouldUseExponentialNotation(value)
    ? value.toExponential()
    : roundTo(value, precision).toString();
}

// Like formatValue, but limits the mantissa to a few digits, so that the axis bounds stay
// short (e.g., the float32 range is shown as -1.7014e+38 instead of -1.7014118346046923e+38).
function formatAxisBound(value: number, precision: number) {
  if (!shouldUseExponentialNotation(value)) {
    return formatValue(value, precision);
  }
  // Drop trailing zeros of the mantissa (e.g., 1.0000e+5 → 1e+5).
  return value.toExponential(4).replace(/\.?0+e/, "e");
}

// A bound that wasn't changed from the stored range is accepted even if it lies outside of
// the dtype range (e.g., in ranges stored by older versions), so that the other bound can
// still be edited.
function isValidRange(
  min: number,
  max: number,
  defaultMinMax: readonly [number, number],
  storedRange: { min: number; max: number },
) {
  const [lowerLimit, upperLimit] = defaultMinMax;
  return (
    min < max &&
    (min === storedRange.min || lowerLimit <= min) &&
    (max === storedRange.max || max <= upperLimit)
  );
}

export default function Histogram(props: HistogramProps) {
  const {
    data,
    layerName,
    intensityRangeMin,
    intensityRangeMax,
    min,
    max,
    isInEditMode,
    defaultMinMax,
    supportFractions,
    reloadHistogram,
  } = props;
  const dispatch = useDispatch();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pendingRange, setPendingRange] = useState<PendingRange | null>(null);

  const onChangeLayer = (
    propertyName: keyof DatasetLayerConfiguration,
    value: [number, number] | number | boolean,
  ) => dispatch(updateLayerSettingAction(layerName, propertyName, value));

  // Only valid ranges are queued, and both bounds are committed together, regardless of
  // the order in which the inputs were edited.
  const commitRangeDebounced = useMemo(
    () =>
      debounce((newMin: number, newMax: number, targetLayerName: string) => {
        // The commit may run after unmounting, when the layer may not exist anymore.
        const layerExists = getDataLayers(Store.getState().dataset).some(
          (layer) => layer.name === targetLayerName,
        );
        if (!layerExists) return;
        // Keep the draft (e.g., a half-typed other bound), but tie it to the committed
        // range so that it isn't discarded as outdated. Drop it once it is fully committed.
        setPendingRange((prev) =>
          prev == null || (prev.min === newMin && prev.max === newMax)
            ? null
            : { ...prev, basedOn: { ...prev.basedOn, min: newMin, max: newMax } },
        );
        dispatch(updateLayerSettingAction(targetLayerName, "min", newMin));
        dispatch(updateLayerSettingAction(targetLayerName, "max", newMax));
      }, 500),
    [dispatch],
  );

  useEffect(() => {
    if (!isInEditMode) {
      // Commit the last valid edit right away instead of showing the old range in the
      // meantime, and drop an invalid draft so that it doesn't reappear on the next edit.
      commitRangeDebounced.flush();
      setPendingRange(null);
    }
  }, [isInEditMode, commitRangeDebounced]);

  useEffect(() => () => commitRangeDebounced.flush(), [commitRangeDebounced]);

  useEffect(() => {
    if (canvasRef.current != null) {
      drawHistograms(canvasRef.current, {
        data,
        min,
        max,
        defaultMinMax,
        intensityRangeMin,
        intensityRangeMax,
      });
    }
  }, [data, min, max, defaultMinMax, intensityRangeMin, intensityRangeMax]);

  const { min: minRange, max: maxRange } = getMinAndMax({ min, max, data, defaultMinMax });
  const isPendingRangeCurrent =
    pendingRange != null &&
    pendingRange.basedOn.min === min &&
    pendingRange.basedOn.max === max &&
    pendingRange.basedOn.data === data;

  useEffect(() => {
    if (pendingRange != null && !isPendingRangeCurrent) {
      // The range or the data changed from elsewhere (e.g., by clipping the histogram).
      // A queued commit would overwrite that change with values based on the old range.
      commitRangeDebounced.cancel();
      setPendingRange(null);
    }
  }, [pendingRange, isPendingRangeCurrent, commitRangeDebounced]);

  const currentMin = isPendingRangeCurrent ? pendingRange.min : minRange;
  const currentMax = isPendingRangeCurrent ? pendingRange.max : maxRange;

  const precision = Math.max(getPrecisionOf(currentMin), getPrecisionOf(currentMax)) + 3;
  const tipFormatter = (value: number | undefined) => formatValue(value, precision);

  const onBoundChange = (side: "min" | "max", value: number | null) => {
    if (value == null) return;
    // The typed value is kept (and flagged if invalid) instead of being clamped,
    // so that the input shows what was entered.
    const newMin = side === "min" ? value : currentMin;
    const newMax = side === "max" ? value : currentMax;
    setPendingRange({ min: newMin, max: newMax, basedOn: { min, max, data } });
    // An invalid value (e.g., a half-typed number) doesn't cancel the queued commit, so
    // that the last valid edit of the other bound is still saved.
    if (isValidRange(newMin, newMax, defaultMinMax, { min: minRange, max: maxRange })) {
      commitRangeDebounced(newMin, newMax, layerName);
    }
  };

  const onThresholdChange = (values: number[]) => {
    const [firstVal, secVal] = values;
    onChangeLayer("intensityRange", firstVal < secVal ? [firstVal, secVal] : [secVal, firstVal]);
  };

  const maybeWarning =
    data === null ? (
      <Alert
        type="warning"
        style={{ margin: 10 }}
        title={
          <>
            Histogram couldn’t be fetched.{" "}
            <a href="#" onClick={reloadHistogram}>
              Retry
            </a>
          </>
        }
        showIcon
      />
    ) : null;

  const isRangeInvalid = !isValidRange(currentMin, currentMax, defaultMinMax, {
    min: minRange,
    max: maxRange,
  });
  const tooltipTitleFor = (leftOrRight: string) =>
    `Value at the ${leftOrRight} end of the histogram's x-axis (and of the slider) for layer ${layerName}. Scientific notation (e.g. 9e+10) is supported.` +
    (isRangeInvalid
      ? ` The left value must be smaller than the right one, and both must lie within ${tipFormatter(defaultMinMax[0])} … ${tipFormatter(defaultMinMax[1])}.`
      : "");

  const axisInputStyle = { width: 90 };
  const axisLabelStyle = { fontSize: 12 };
  const maybeCeilFn = supportFractions ? (val: number) => val : Math.ceil;
  return (
    <Spin spinning={data === undefined}>
      <div style={{ display: "grid", placeItems: "center", position: "relative" }}>
        {maybeWarning && <div style={{ position: "absolute", zIndex: 1 }}>{maybeWarning}</div>}
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          // Shrink (keeping the aspect ratio) when a vertical scrollbar takes space from the sidebar.
          style={{ opacity: maybeWarning ? 0.5 : 1, width: "100%", maxWidth: CANVAS_WIDTH }}
        />
      </div>
      <Slider
        range
        value={[intensityRangeMin, intensityRangeMax]}
        min={minRange}
        max={maxRange}
        defaultValue={[minRange, maxRange]}
        onChange={onThresholdChange}
        onChangeComplete={onThresholdChange}
        step={maybeCeilFn((maxRange - minRange) / 255)}
        tooltip={{ formatter: tipFormatter }}
        style={{
          width: "100%",
          maxWidth: CANVAS_WIDTH,
          margin: 0,
          marginTop: 6,
        }}
      />
      <Flex
        justify="space-between"
        align="center"
        gap={6}
        wrap
        style={{ width: "100%", maxWidth: CANVAS_WIDTH, marginTop: 4 }}
      >
        {isInEditMode ? (
          <>
            <FastTooltip title={tooltipTitleFor("left")}>
              <InputNumber
                size="small"
                value={currentMin}
                status={isRangeInvalid ? "error" : undefined}
                onChange={(value) => onBoundChange("min", value)}
                style={axisInputStyle}
              />
            </FastTooltip>
            <Typography.Text type="secondary" style={axisLabelStyle}>
              ← x-axis range →{" "}
              <FastTooltip title="Stop editing histogram range">
                <CloseOutlined
                  style={{ cursor: "pointer", marginLeft: 4 }}
                  onClick={() => onChangeLayer("isInEditMode", false)}
                />
              </FastTooltip>
            </Typography.Text>
            <FastTooltip title={tooltipTitleFor("right")}>
              <InputNumber
                size="small"
                value={currentMax}
                status={isRangeInvalid ? "error" : undefined}
                onChange={(value) => onBoundChange("max", value)}
                style={axisInputStyle}
              />
            </FastTooltip>
          </>
        ) : (
          [minRange, maxRange].map((bound, index) => (
            <FastTooltip
              key={index}
              title={`${tipFormatter(bound)}. Click to edit the range of the histogram's x-axis.`}
            >
              <Typography.Text
                type="secondary"
                style={{
                  ...axisLabelStyle,
                  fontFamily: "monospace",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
                onClick={() => onChangeLayer("isInEditMode", true)}
              >
                {formatAxisBound(bound, precision)}
              </Typography.Text>
            </FastTooltip>
          ))
        )}
      </Flex>
    </Spin>
  );
}
