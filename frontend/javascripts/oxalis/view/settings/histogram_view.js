// @flow

import { Slider } from "antd";
import * as _ from "lodash";
import * as React from "react";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import { type DatasetLayerConfiguration } from "oxalis/store";
import { updateLayerSettingAction } from "oxalis/model/actions/settings_actions";
import { type ElementClass } from "admin/api_flow_types";
import type { APIHistogramData } from "admin/api_flow_types";
import { type Vector3 } from "oxalis/constants";
import { roundTo } from "libs/utils";

type OwnProps = {|
  data: APIHistogramData,
  layerName: string,
  min: number,
  max: number,
|};

type HistogramProps = {
  ...OwnProps,
  onChangeLayer: (
    layerName: string,
    propertyName: $Keys<DatasetLayerConfiguration>,
    value: [number, number],
  ) => void,
};

const uint24Colors = [[255, 65, 54], [46, 204, 64], [24, 144, 255]];
const canvasHeight = 100;
const canvasWidth = 300;

export function isHistogramSupported(elementClass: ElementClass): boolean {
  return ["int8", "uint8", "int16", "uint16", "float", "uint24"].includes(elementClass);
}

class Histogram extends React.PureComponent<HistogramProps> {
  canvasRef: ?HTMLCanvasElement;

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

  componentDidUpdate() {
    this.updateCanvas();
  }

  updateCanvas() {
    if (this.canvasRef == null) {
      return;
    }
    const ctx = this.canvasRef.getContext("2d");
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    const { data } = this.props;
    // Compute the overall maximum count, so the RGB curves are scaled correctly relative to each other
    const maxValue = Math.max(...data.map(({ elementCounts }) => Math.max(...elementCounts)));
    for (const [i, histogram] of data.entries()) {
      const color = this.props.data.length > 1 ? uint24Colors[i] : uint24Colors[2];
      this.drawHistogram(ctx, histogram, maxValue, color);
    }
  }

  drawHistogram = (
    ctx: CanvasRenderingContext2D,
    histogram: $ElementType<APIHistogramData, number>,
    maxValue: number,
    color: Vector3,
  ) => {
    const { min, max } = this.props;
    const { min: minRange, max: maxRange, elementCounts } = histogram;
    const rangeLength = maxRange - minRange;
    this.drawYAxis(ctx);
    ctx.fillStyle = `rgba(${color.join(",")}, 0.1)`;
    ctx.strokeStyle = `rgba(${color.join(",")})`;
    // Here we normalize all values to the interval of 0 - 9 and then add 1
    // to gain an interval reaching from 1 - 10.
    const downscalingFactor = 9 / maxValue;
    const downscaledData = elementCounts.map(
      value => Math.log10(downscalingFactor * value + 1) * canvasHeight,
    );
    const activeRegion = new Path2D();
    ctx.moveTo(0, downscaledData[0]);
    activeRegion.moveTo(((min - minRange) / rangeLength) * canvasWidth, 0);
    for (let i = 0; i < downscaledData.length; i++) {
      const x = (i / downscaledData.length) * canvasWidth;
      const xValue = minRange + i * (rangeLength / downscaledData.length);
      if (xValue >= min && xValue <= max) {
        activeRegion.lineTo(x, downscaledData[i]);
      }
      ctx.lineTo(x, downscaledData[i]);
    }
    ctx.stroke();
    ctx.closePath();
    activeRegion.lineTo(((max - minRange) / rangeLength) * canvasWidth, 0);
    activeRegion.lineTo(((min - minRange) / rangeLength) * canvasWidth, 0);
    activeRegion.closePath();
    ctx.fill(activeRegion);
  };

  drawYAxis = (ctx: CanvasRenderingContext2D) => {
    // Maximum value of the y axis is always 10. Therefore the axis is independent from any data.
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, canvasHeight);
    const numberOfScaleLines = 5;
    const intervalSize = 2;
    for (let interval = 1; interval <= numberOfScaleLines; interval++) {
      // We use canvasHeight - 1 because else half of the top line would be cut off.
      const lineHeight = Math.round(Math.log10(intervalSize * interval) * (canvasHeight - 1));
      ctx.moveTo(0, lineHeight);
      ctx.lineTo(8, lineHeight);
    }
  };

  onThresholdChange = ([firstVal, secVal]: [number, number]) => {
    const { layerName } = this.props;
    if (firstVal < secVal) {
      this.props.onChangeLayer(layerName, "intensityRange", [firstVal, secVal]);
    } else {
      this.props.onChangeLayer(layerName, "intensityRange", [secVal, firstVal]);
    }
  };

  render() {
    const { min, max, data } = this.props;
    const { min: minRange, max: maxRange } = data[0];
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
          value={[min, max]}
          min={minRange}
          max={maxRange}
          range
          defaultValue={[minRange, maxRange]}
          onChange={this.onThresholdChange}
          onAfterChange={this.onThresholdChange}
          style={{ width: canvasWidth, margin: 0, marginBottom: 18 }}
          step={(maxRange - minRange) / 255}
          tipFormatter={val => roundTo(val, 2).toString()}
        />
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
