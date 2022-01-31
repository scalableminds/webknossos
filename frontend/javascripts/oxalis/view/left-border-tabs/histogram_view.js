// @flow

import type { Dispatch } from "redux";
import { Slider, Row, Col, InputNumber, Tooltip } from "antd";
import { VerticalAlignMiddleOutlined } from "@ant-design/icons";
import { connect } from "react-redux";
import * as React from "react";
import * as _ from "lodash";

import type { APIHistogramData, ElementClass } from "types/api_flow_types";
import { OrthoViews, type Vector2, type Vector3 } from "oxalis/constants";
import { getConstructorForElementClass } from "oxalis/model/bucket_data_handling/bucket";
import { getLayerByName } from "oxalis/model/accessors/dataset_accessor";
import { roundTo } from "libs/utils";
import { updateLayerSettingAction } from "oxalis/model/actions/settings_actions";
import Store, { type DatasetLayerConfiguration } from "oxalis/store";
import api from "oxalis/api/internal_api";
import Toast from "libs/toast";
import { div } from "../../shaders/utils.glsl";

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
const canvasWidth = 318;

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

  componentDidUpdate(prevProps: HistogramProps) {
    if (
      prevProps.min !== this.props.min ||
      prevProps.max !== this.props.max ||
      prevProps.data !== this.props.data
    ) {
      const { min, max } = getMinAndMax(this.props);
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({ currentMin: min, currentMax: max });
    }
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

  getClippingValues = async (layerName: string, thresholdRatio: number = 0.05) => {
    const { elementClass } = getLayerByName(Store.getState().dataset, layerName);
    const [TypedArrayClass] = getConstructorForElementClass(elementClass);

    const [cuboidXY, cuboidXZ, cuboidYZ] = await Promise.all([
      api.data.getViewportData(OrthoViews.PLANE_XY, layerName),
      api.data.getViewportData(OrthoViews.PLANE_XZ, layerName),
      api.data.getViewportData(OrthoViews.PLANE_YZ, layerName),
    ]);
    const dataForAllViewports = new TypedArrayClass(
      cuboidXY.length + cuboidXZ.length + cuboidYZ.length,
    );

    dataForAllViewports.set(cuboidXY);
    dataForAllViewports.set(cuboidXZ, cuboidXY.length);
    dataForAllViewports.set(cuboidYZ, cuboidXY.length + cuboidXZ.length);

    const localHist = new Map();
    for (let i = 0; i < dataForAllViewports.length; i++) {
      if (dataForAllViewports[i] !== 0) {
        const value = localHist.get(dataForAllViewports[i]);
        localHist.set(dataForAllViewports[i], value != null ? value + 1 : 1);
      }
    }

    const sortedHistKeys = Array.from(localHist.keys()).sort((a, b) => a - b);
    const accumulator = new Map();
    let area = 0;
    for (const key of sortedHistKeys) {
      const value = localHist.get(key);
      area += value != null ? value : 0;
      accumulator.set(key, area);
    }
    const thresholdValue = (thresholdRatio * area) / 2.0;

    let lowerClip = -1;
    for (const key of sortedHistKeys) {
      const value = accumulator.get(key);
      if (value != null && value >= thresholdValue) {
        lowerClip = key;
        break;
      }
    }
    let upperClip = -1;
    for (const key of sortedHistKeys.reverse()) {
      const value = accumulator.get(key);
      if (value != null && value < area - thresholdValue) {
        upperClip = key;
        break;
      }
    }
    return [lowerClip, upperClip];
  };

  clipHistogram = async (isInEditMode: boolean, layerName: string) => {
    const [lowerClip, upperClip] = await this.getClippingValues(layerName);
    if (lowerClip === -1 || upperClip === -1) {
      Toast.warning(
        "The histogram could not be clipped, because the data did not contain any brightness values greater than 0.",
      );
      return;
    }
    if (!isInEditMode) {
      this.onThresholdChange([lowerClip, upperClip]);
    } else {
      this.onThresholdChange([lowerClip, upperClip]);
      this.setState({ currentMin: lowerClip, currentMax: upperClip });
      this.props.onChangeLayer(layerName, "min", lowerClip);
      this.props.onChangeLayer(layerName, "max", upperClip);
    }
  };

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
    const editModeAddendum = isInEditMode
      ? "In Edit Mode, the histogram's range will be adjusted, too."
      : "";
    const tooltipText = `Automatically clip the histogram to enhance contrast. ${editModeAddendum}`;
    return (
      <React.Fragment>
        <div
          style={{
            position: "relative",
            width: 22,
            top: -22,
            left: 237,
          }}
        >
          <Tooltip title={tooltipText}>
            <VerticalAlignMiddleOutlined
              style={{
                position: "relative",
                transform: "rotate(90deg)",
                cursor: "pointer",
              }}
              onClick={() => this.clipHistogram(isInEditMode, layerName)}
            />
          </Tooltip>
        </div>
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
          style={{ width: canvasWidth, margin: 0, marginTop: 6 }}
        />
        {isInEditMode ? (
          <Row type="flex" align="middle" style={{ marginTop: 6 }}>
            <Col span={4}>
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
