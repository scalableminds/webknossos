// @flow

import { Slider } from "antd";
import * as _ from "lodash";
import * as React from "react";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import { type DatasetLayerConfiguration } from "oxalis/store";
import { updateLayerSettingAction } from "oxalis/model/actions/settings_actions";

type OwnProps = {|
  data: Array<number>,
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

const canvasHeight = 100;
const canvasWidth = 300;

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
    ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
    ctx.strokeStyle = "#1890ff";
    this.updateCanvas();
  }

  componentDidUpdate(_prevProps) {
    this.updateCanvas();
  }

  updateCanvas = () => {
    if (this.canvasRef == null) {
      return;
    }
    const { min, max, data } = this.props;
    const ctx = this.canvasRef.getContext("2d");
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    const maxValue = Math.max(...data);
    const downscaledData = this.props.data.map(value =>
      value > 0 ? (Math.log(value) / Math.log(maxValue)) * canvasHeight : 0,
    );
    const activeRegion = new Path2D();
    ctx.beginPath();
    ctx.moveTo(0, downscaledData[0]);
    activeRegion.moveTo((min / downscaledData.length) * canvasWidth, 0);
    for (let i = 0; i < downscaledData.length; i++) {
      const x = (i / downscaledData.length) * canvasWidth;
      if (i >= min && i <= max) {
        activeRegion.lineTo(x, downscaledData[i]);
      }
      ctx.lineTo(x, downscaledData[i]);
    }
    ctx.stroke();
    ctx.closePath();
    activeRegion.lineTo((max / downscaledData.length) * canvasWidth, 0);
    activeRegion.lineTo((min / downscaledData.length) * canvasWidth, 0);
    activeRegion.closePath();
    ctx.fill(activeRegion);
  };

  // eslint-disable-next-line react/sort-comp
  updateCanvasThrottled = _.throttle(this.updateCanvas, 100);

  onThresholdChange = ([firstVal, secVal]: [number, number]) => {
    const { layerName } = this.props;
    if (firstVal < secVal) {
      this.props.onChangeLayer(layerName, "bounds", [firstVal, secVal]);
    } else {
      this.props.onChangeLayer(layerName, "bounds", [secVal, firstVal]);
    }
  };

  render() {
    const { min, max } = this.props;
    return (
      <React.Fragment>
        <canvas
          ref={ref => {
            this.canvasRef = ref;
          }}
          width={300}
          height={canvasHeight}
        />
        <Slider
          value={[min, max]}
          min={0}
          max={255}
          range
          defaultValue={[0, this.props.data.length - 1]}
          onChange={this.onThresholdChange}
          onAfterChange={this.onThresholdChange}
          style={{ width: 300, margin: 0, marginBottom: 18 }}
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
