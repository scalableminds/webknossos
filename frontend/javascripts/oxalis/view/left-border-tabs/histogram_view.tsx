import type { Dispatch } from "redux";
import { Alert, Slider, Row, Col, InputNumber, Spin, Tooltip } from "antd";
import { connect } from "react-redux";
import * as React from "react";
import * as _ from "lodash";
import { PRIMARY_COLOR, Vector2, Vector3 } from "oxalis/constants";
import type { APIHistogramData, HistogramDatum, ElementClass } from "types/api_flow_types";
import { roundTo } from "libs/utils";
import { updateLayerSettingAction } from "oxalis/model/actions/settings_actions";
import type { DatasetLayerConfiguration } from "oxalis/store";
import { CloseOutlined } from "@ant-design/icons";

type OwnProps = {
  data: APIHistogramData | null | undefined;
  layerName: string;
  intensityRangeMin: number;
  intensityRangeMax: number;
  min?: number;
  max?: number;
  isInEditMode: boolean;
  defaultMinMax: Vector2;
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
];
const canvasHeight = 100;
const canvasWidth = 318;

export function isHistogramSupported(elementClass: ElementClass): boolean {
  return ["int8", "uint8", "int16", "uint16", "float", "uint24"].includes(elementClass);
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

class Histogram extends React.PureComponent<HistogramProps, HistogramState> {
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
    ctx.translate(0, canvasHeight);
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
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    const { min, max } = getMinAndMax(this.props);
    const { data } = this.props;

    if (data == null) return;

    // Compute the overall maximum count, so the RGB curves are scaled correctly relative to each other.
    const maxValue = Math.max(
      ...data.map(({ elementCounts, min: histogramMin, max: histogramMax }) => {
        // We only take the elements of the array into account that are displayed.
        const displayedPartStartOffset = Math.max(histogramMin, min) - histogramMin;
        const displayedPartEndOffset = Math.min(histogramMax, max) - histogramMin;
        // Here we scale the offsets to the range of the elements array.
        const startingIndex =
          (displayedPartStartOffset * elementCounts.length) / (histogramMax - histogramMin);
        const endingIndex =
          (displayedPartEndOffset * elementCounts.length) / (histogramMax - histogramMin);
        return Math.max(...elementCounts.slice(startingIndex, endingIndex + 1));
      }),
    );

    for (const [i, histogram] of data.entries()) {
      const color = data.length > 1 ? uint24Colors[i] : PRIMARY_COLOR;
      // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number[]' is not assignable to p... Remove this comment to see the full error message
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
    const { intensityRangeMin, intensityRangeMax } = this.props;
    const { min: histogramMin, max: histogramMax, elementCounts } = histogram;
    const histogramLength = histogramMax - histogramMin;
    const fullLength = maxRange - minRange;
    const xOffset = histogramMin - minRange;
    ctx.fillStyle = `rgba(${color.join(",")}, 0.1)`;
    ctx.strokeStyle = `rgba(${color.join(",")})`;
    ctx.beginPath();
    // Scale data to the height of the histogram canvas.
    const downscaledData = elementCounts.map((value) => (value / maxValue) * canvasHeight);
    const activeRegion = new Path2D();
    ctx.moveTo(0, 0);
    activeRegion.moveTo(((intensityRangeMin - minRange) / fullLength) * canvasWidth, 0);

    for (let i = 0; i < downscaledData.length; i++) {
      const xInHistogramScale = (i * histogramLength) / downscaledData.length;
      const xInCanvasScale = ((xOffset + xInHistogramScale) * canvasWidth) / fullLength;
      const xValue = histogramMin + xInHistogramScale;

      if (xValue >= intensityRangeMin && xValue <= intensityRangeMax) {
        activeRegion.lineTo(xInCanvasScale, downscaledData[i]);
      }

      ctx.lineTo(xInCanvasScale, downscaledData[i]);
    }

    ctx.stroke();
    ctx.closePath();
    const activeRegionRightLimit = Math.min(histogramMax, intensityRangeMax);
    const activeRegionLeftLimit = Math.max(histogramMin, intensityRangeMin);
    activeRegion.lineTo(((activeRegionRightLimit - minRange) / fullLength) * canvasWidth, 0);
    activeRegion.lineTo(((activeRegionLeftLimit - minRange) / fullLength) * canvasWidth, 0);
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

  updateMinimumDebounced = _.debounce(
    (value, layerName) => this.props.onChangeLayer(layerName, "min", value),
    500,
  );

  updateMaximumDebounced = _.debounce(
    (value, layerName) => this.props.onChangeLayer(layerName, "max", value),
    500,
  );

  render() {
    const { intensityRangeMin, intensityRangeMax, isInEditMode, defaultMinMax, layerName, data } =
      this.props;

    if (data === null) {
      return (
        <Alert
          type="warning"
          style={{ margin: 10 }}
          message={
            <>
              Histogram couldn&apos;t be fetched.{" "}
              <a href="#" onClick={this.props.reloadHistogram}>
                Retry
              </a>
            </>
          }
          showIcon
        />
      );
    }

    const { currentMin, currentMax } = this.state;
    const { min: minRange, max: maxRange } = getMinAndMax(this.props);

    const tooltipTitleFor = (minimumOrMaximum: string) =>
      `Enter the ${minimumOrMaximum} possible value for layer ${layerName}. Scientific (e.g. 9e+10) notation is supported.`;

    const minMaxInputStyle = {
      width: "100%",
    };
    return (
      <Spin spinning={data === undefined}>
        <canvas ref={this.onCanvasRefChange} width={canvasWidth} height={canvasHeight} />
        <Slider
          range
          value={[intensityRangeMin, intensityRangeMax]}
          min={minRange}
          max={maxRange}
          defaultValue={[minRange, maxRange]}
          onChange={this.onThresholdChange}
          onChangeComplete={this.onThresholdChange}
          step={(maxRange - minRange) / 255}
          tooltip={{ formatter: this.tipFormatter }}
          style={{
            width: canvasWidth,
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
              <Tooltip title={tooltipTitleFor("minimum")}>
                <InputNumber
                  size="small"
                  min={defaultMinMax[0]}
                  max={maxRange}
                  defaultValue={currentMin}
                  value={currentMin}
                  onChange={(value) => {
                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number' is not assignable to par... Remove this comment to see the full error message
                    value = parseFloat(value);

                    if (value <= maxRange) {
                      this.setState({
                        currentMin: value,
                      });
                      this.updateMinimumDebounced(value, layerName);
                    }
                  }}
                  style={minMaxInputStyle}
                />
              </Tooltip>
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
              <Tooltip title={tooltipTitleFor("maximum")}>
                <InputNumber
                  size="small"
                  min={minRange}
                  max={defaultMinMax[1]}
                  defaultValue={currentMax}
                  value={currentMax}
                  onChange={(value) => {
                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number' is not assignable to par... Remove this comment to see the full error message
                    value = parseFloat(value);

                    if (value >= minRange) {
                      this.setState({
                        currentMax: value,
                      });
                      this.updateMaximumDebounced(value, layerName);
                    }
                  }}
                  style={minMaxInputStyle}
                />
              </Tooltip>
            </Col>
            <Tooltip title="Stop editing histogram range">
              <Col
                span={2}
                style={{ textAlign: "right", cursor: "pointer" }}
                onClick={() => this.props.onChangeLayer(layerName, "isInEditMode", !isInEditMode)}
              >
                <CloseOutlined />
              </Col>
            </Tooltip>
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
