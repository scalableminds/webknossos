// @flow

import { Slider, Row, Col, InputNumber, Tooltip } from "antd";
import * as _ from "lodash";
import * as React from "react";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import { type DatasetLayerConfiguration } from "oxalis/store";
import { updateLayerSettingAction } from "oxalis/model/actions/settings_actions";
import type { APIHistogramData, ElementClass } from "types/api_flow_types";
import type { Vector3, Vector2 } from "oxalis/constants";
import { roundTo } from "libs/utils";

type OwnProps = {|
  data: APIHistogramData,
  layerName: string,
  intensityRangeMin: number,
  intensityRangeMax: number,
  min?: number,
  max?: number,
  isInEditMode: boolean,
  defaultMinMax: Vector2,
|};

type HistogramProps = {
  ...OwnProps,
  onChangeLayer: (
    layerName: string,
    propertyName: $Keys<DatasetLayerConfiguration>,
    value: [number, number] | number,
  ) => void,
};

type HistogramState = {
  currentMin: number,
  currentMax: number,
};

const uint24Colors = [[255, 65, 54], [46, 204, 64], [24, 144, 255]];
const canvasHeight = 100;
const canvasWidth = 300;

export function isHistogramSupported(elementClass: ElementClass): boolean {
  return ["int8", "uint8", "int16", "uint16", "float", "uint24"].includes(elementClass);
}

function getMinAndMax(props: HistogramProps) {
  const { min, max, data } = props;
  if (min != null && max != null) {
    return { min, max };
  }
  const dataMin = Math.min(...data.map(({ min: minOfHistPart }) => minOfHistPart));
  const dataMax = Math.max(...data.map(({ max: maxOfHistPart }) => maxOfHistPart));
  return { min: dataMin, max: dataMax };
}

function getPrecisionOf(num: number): number {
  const decimals = num.toString().split(".")[1];
  return decimals ? decimals.length : 0;
}

class Histogram extends React.PureComponent<HistogramProps, HistogramState> {
  canvasRef: ?HTMLCanvasElement;

  constructor(props: HistogramProps) {
    super(props);
    const { min, max } = getMinAndMax(props);
    this.state = { currentMin: min, currentMax: max };
  }

  componentDidMount() {
    if (this.canvasRef == null) {
      return;
    }
    const ctx = this.canvasRef.getContext("2d");
    ctx.translate(0, canvasHeight);
    ctx.scale(1, -1);
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    this.updateCanvas();
  }

  componentWillReceiveProps(newProps: HistogramProps) {
    const { min, max } = getMinAndMax(newProps);
    this.setState({ currentMin: min, currentMax: max });
  }

  componentDidUpdate() {
    this.updateCanvas();
  }

  updateCanvas() {
    if (this.canvasRef == null) {
      return;
    }
    const ctx = this.canvasRef.getContext("2d");
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    const { min, max } = getMinAndMax(this.props);
    const { data } = this.props;
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
      const color = this.props.data.length > 1 ? uint24Colors[i] : uint24Colors[2];
      this.drawHistogram(ctx, histogram, maxValue, color, min, max);
    }
  }

  getPrecision = () =>
    Math.max(getPrecisionOf(this.state.currentMin), getPrecisionOf(this.state.currentMax)) + 3;

  drawHistogram = (
    ctx: CanvasRenderingContext2D,
    histogram: $ElementType<APIHistogramData, number>,
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
    const downscaledData = elementCounts.map(value => (value / maxValue) * canvasHeight);
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

  onThresholdChange = ([firstVal, secVal]: [number, number]) => {
    const { layerName } = this.props;
    if (firstVal < secVal) {
      this.props.onChangeLayer(layerName, "intensityRange", [firstVal, secVal]);
    } else {
      this.props.onChangeLayer(layerName, "intensityRange", [secVal, firstVal]);
    }
  };

  tipFormatter = (value: number) =>
    value > 10000 ? value.toExponential() : roundTo(value, this.getPrecision()).toString();

  // eslint-disable-next-line react/sort-comp
  updateMinimumDebounced = _.debounce(
    (value, layerName) => this.props.onChangeLayer(layerName, "min", value),
    500,
  );

  updateMaximumDebounced = _.debounce(
    (value, layerName) => this.props.onChangeLayer(layerName, "max", value),
    500,
  );

  render() {
    const {
      intensityRangeMin,
      intensityRangeMax,
      isInEditMode,
      defaultMinMax,
      layerName,
    } = this.props;
    const { currentMin, currentMax } = this.state;
    const { min: minRange, max: maxRange } = getMinAndMax(this.props);
    const tooltipTitleFor = (minimumOrMaximum: string) =>
      `Enter the ${minimumOrMaximum} possible value for layer ${layerName}. Scientific (e.g. 9e+10) notation is supported.`;

    const minMaxInputStyle = { width: "100%" };

    return (
      <React.Fragment>
        <canvas
          ref={ref => {
            this.canvasRef = ref;
          }}
          width={canvasWidth}
          height={canvasHeight}
        />
        <Slider
          range
          value={[intensityRangeMin, intensityRangeMax]}
          min={minRange}
          max={maxRange}
          defaultValue={[minRange, maxRange]}
          onChange={this.onThresholdChange}
          onAfterChange={this.onThresholdChange}
          step={(maxRange - minRange) / 255}
          tipFormatter={this.tipFormatter}
          style={{ width: canvasWidth, margin: 0, marginBottom: 6 }}
        />
        {isInEditMode ? (
          <Row type="flex" align="middle">
            <Col span={4}>
              <label className="setting-label">min:</label>
            </Col>
            <Col span={8}>
              <Tooltip title={tooltipTitleFor("minimum")}>
                <InputNumber
                  size="small"
                  min={defaultMinMax[0]}
                  max={maxRange}
                  defaultValue={currentMin}
                  value={currentMin}
                  onChange={value => {
                    value = parseFloat(value);
                    if (value <= maxRange) {
                      this.setState({ currentMin: value });
                      this.updateMinimumDebounced(value, layerName);
                    }
                  }}
                  style={minMaxInputStyle}
                />
              </Tooltip>
            </Col>
            <Col span={4}>
              <label className="setting-label" style={{ width: "100%", textAlign: "center" }}>
                max:
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
                  onChange={value => {
                    value = parseFloat(value);
                    if (value >= minRange) {
                      this.setState({ currentMax: value });
                      this.updateMaximumDebounced(value, layerName);
                    }
                  }}
                  style={minMaxInputStyle}
                />
              </Tooltip>
            </Col>
          </Row>
        ) : null}
      </React.Fragment>
    );
  }
}

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onChangeLayer(layerName, propertyName, value) {
    dispatch(updateLayerSettingAction(layerName, propertyName, value));
  },
});

export default connect<HistogramProps, OwnProps, _, _, _, _>(
  null,
  mapDispatchToProps,
)(Histogram);
