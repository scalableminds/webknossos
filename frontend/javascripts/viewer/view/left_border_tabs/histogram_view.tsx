import { CloseOutlined } from "@ant-design/icons";
import { Alert, Col, InputNumber, Row, Spin } from "antd";
import FastTooltip from "components/fast_tooltip";
import { Slider } from "components/slider";
import { roundTo } from "libs/utils";
import debounce from "lodash-es/debounce";
import range from "lodash-es/range";
import { PureComponent } from "react";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import type { APIHistogramData, ElementClass, HistogramDatum } from "types/api_types";
import { PRIMARY_COLOR, type Vector3 } from "viewer/constants";
import { updateLayerSettingAction } from "viewer/model/actions/settings_actions";
import type { DatasetLayerConfiguration } from "viewer/store";

type OwnProps = {
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
type HistogramProps = OwnProps & {
  onChangeLayer: (
    layerName: string,
    propertyName: keyof DatasetLayerConfiguration,
    value: [number, number] | number | boolean,
  ) => void;
};
type HistogramState = {
  currentMin: number;
  currentMax: number;
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

function getMinAndMax(props: HistogramProps) {
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
// (note that the canvas is flipped, see onCanvasRefChange), whereas intensity is
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

class Histogram extends PureComponent<HistogramProps, HistogramState> {
  canvasRef: HTMLCanvasElement | null | undefined;

  constructor(props: HistogramProps) {
    super(props);
    const { min, max } = getMinAndMax(props);
    this.state = {
      currentMin: min,
      currentMax: max,
    };
  }

  componentDidUpdate(prevProps: HistogramProps) {
    if (
      prevProps.min !== this.props.min ||
      prevProps.max !== this.props.max ||
      prevProps.data !== this.props.data
    ) {
      const { min, max } = getMinAndMax(this.props);
      this.setState({
        currentMin: min,
        currentMax: max,
      });
    }

    this.updateCanvas();
  }

  onCanvasRefChange = (ref: HTMLCanvasElement | null | undefined) => {
    this.canvasRef = ref;

    if (this.canvasRef == null) {
      return;
    }

    const ctx = this.canvasRef.getContext("2d");
    if (ctx == null) {
      return;
    }
    ctx.translate(0, CANVAS_HEIGHT);
    ctx.scale(1, -1);
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    this.updateCanvas();
  };

  updateCanvas() {
    if (this.canvasRef == null) {
      return;
    }

    const ctx = this.canvasRef.getContext("2d");
    if (ctx == null) {
      return;
    }
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    const { min, max } =
      this.props.data != null ? getMinAndMax(this.props) : DUMMY_HISTOGRAM_DATA[0];
    const data = this.props.data ?? DUMMY_HISTOGRAM_DATA;

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
      this.drawHistogram(ctx, histogram, maxValue, color, min, max);
    }
  }

  getPrecision = () =>
    Math.max(getPrecisionOf(this.state.currentMin), getPrecisionOf(this.state.currentMax)) + 3;

  drawHistogram = (
    ctx: CanvasRenderingContext2D,
    histogram: HistogramDatum,
    maxValue: number,
    color: Vector3,
    minRange: number,
    maxRange: number,
  ) => {
    // Note that the canvas is flipped vertically (see onCanvasRefChange), which is why
    // the y values below are used as-is (i.e., larger y means higher up).
    const { intensityRangeMin, intensityRangeMax } = this.props;
    const { min: histogramMin, max: histogramMax, elementCounts } = histogram;
    const histogramLength = histogramMax - histogramMin;
    const fullLength = maxRange - minRange;
    const xOffset = histogramMin - minRange;
    ctx.fillStyle = `rgba(255, 0, 128, 0.1)`;
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
  };

  onThresholdChange = (values: number[]) => {
    const { layerName } = this.props;
    const [firstVal, secVal] = values;

    if (firstVal < secVal) {
      this.props.onChangeLayer(layerName, "intensityRange", [firstVal, secVal]);
    } else {
      this.props.onChangeLayer(layerName, "intensityRange", [secVal, firstVal]);
    }
  };

  tipFormatter = (value: number | undefined) => {
    if (value == null) {
      return "invalid";
    }
    return value >= 100000 || (value < 0.001 && value > -0.001 && value !== 0)
      ? value.toExponential()
      : roundTo(value, this.getPrecision()).toString();
  };

  updateMinimumDebounced = debounce(
    (value, layerName) => this.props.onChangeLayer(layerName, "min", value),
    500,
  );

  updateMaximumDebounced = debounce(
    (value, layerName) => this.props.onChangeLayer(layerName, "max", value),
    500,
  );

  render() {
    const { intensityRangeMin, intensityRangeMax, isInEditMode, defaultMinMax, layerName, data } =
      this.props;

    const maybeWarning =
      data === null ? (
        <Alert
          type="warning"
          style={{ margin: 10 }}
          title={
            <>
              Histogram couldn’t be fetched.{" "}
              <a href="#" onClick={this.props.reloadHistogram}>
                Retry
              </a>
            </>
          }
          showIcon
        />
      ) : null;

    const { currentMin, currentMax } = this.state;
    const { min: minRange, max: maxRange } = getMinAndMax(this.props);

    const tooltipTitleFor = (minimumOrMaximum: string) =>
      `Enter the ${minimumOrMaximum} possible value for layer ${layerName}. Scientific (e.g. 9e+10) notation is supported.`;

    const minMaxInputStyle = {
      width: "100%",
    };
    const maybeCeilFn = this.props.supportFractions ? (val: number) => val : Math.ceil;
    return (
      <Spin spinning={data === undefined}>
        <div style={{ display: "grid", placeItems: "center", position: "relative" }}>
          {maybeWarning && <div style={{ position: "absolute", zIndex: 1 }}>{maybeWarning}</div>}
          <canvas
            ref={this.onCanvasRefChange}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            style={{ opacity: maybeWarning ? 0.5 : 1 }}
          />
        </div>
        <Slider
          range
          value={[intensityRangeMin, intensityRangeMax]}
          min={minRange}
          max={maxRange}
          defaultValue={[minRange, maxRange]}
          onChange={this.onThresholdChange}
          onChangeComplete={this.onThresholdChange}
          step={maybeCeilFn((maxRange - minRange) / 255)}
          tooltip={{ formatter: this.tipFormatter }}
          style={{
            width: CANVAS_WIDTH,
            margin: 0,
            marginTop: 6,
          }}
        />
        {isInEditMode ? (
          <Row
            align="middle"
            style={{
              marginTop: 6,
            }}
          >
            <Col span={3}>
              <label className="setting-label">Min:</label>
            </Col>
            <Col span={8}>
              <FastTooltip title={tooltipTitleFor("minimum")}>
                <InputNumber
                  size="small"
                  min={defaultMinMax[0]}
                  max={maxRange}
                  defaultValue={currentMin}
                  value={currentMin}
                  variant="borderless"
                  onChange={(value) => {
                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number' is not assignable to par... Remove this comment to see the full error message
                    value = Number.parseFloat(value);

                    if (value <= maxRange) {
                      this.setState({
                        currentMin: value,
                      });
                      this.updateMinimumDebounced(value, layerName);
                    }
                  }}
                  style={minMaxInputStyle}
                />
              </FastTooltip>
            </Col>
            <Col span={3}>
              <label
                className="setting-label"
                style={{
                  width: "100%",
                  textAlign: "center",
                }}
              >
                Max:
              </label>
            </Col>
            <Col span={8}>
              <FastTooltip title={tooltipTitleFor("maximum")}>
                <InputNumber
                  size="small"
                  min={minRange}
                  max={defaultMinMax[1]}
                  defaultValue={currentMax}
                  value={currentMax}
                  variant="borderless"
                  onChange={(value) => {
                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number' is not assignable to par... Remove this comment to see the full error message
                    value = Number.parseFloat(value);

                    if (value >= minRange) {
                      this.setState({
                        currentMax: value,
                      });
                      this.updateMaximumDebounced(value, layerName);
                    }
                  }}
                  style={minMaxInputStyle}
                />
              </FastTooltip>
            </Col>
            <FastTooltip title="Stop editing histogram range">
              <Col
                span={2}
                style={{ textAlign: "right", cursor: "pointer" }}
                onClick={() => this.props.onChangeLayer(layerName, "isInEditMode", !isInEditMode)}
              >
                <CloseOutlined />
              </Col>
            </FastTooltip>
          </Row>
        ) : null}
      </Spin>
    );
  }
}

const mapDispatchToProps = (dispatch: Dispatch<any>) => ({
  onChangeLayer(layerName: string, propertyName: keyof DatasetLayerConfiguration, value: any) {
    dispatch(updateLayerSettingAction(layerName, propertyName, value));
  },
});

const connector = connect(null, mapDispatchToProps);
export default connector(Histogram);
