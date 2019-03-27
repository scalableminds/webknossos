// @flow

import * as React from "react";
import { Slider } from "antd";

type Props = {
  data: Array<number>,
};

type State = {
  lowerLimit: number,
  upperLimit: number,
};

const canvasHeight = 100;
const canvasWidth = 300;

export default class SimpleHistogram extends React.PureComponent<Props, State> {
  constructor(props) {
    super(props);
    this.canvasRef = React.createRef();
    this.state = { lowerLimit: 0, upperLimit: props.data.length - 1 };
  }

  componentDidMount() {
    const ctx = this.canvasRef.getContext("2d");
    ctx.translate(0, canvasHeight);
    ctx.scale(1, -1);
    this.updateCanvas();
  }

  updateCanvas() {
    const { lowerLimit, upperLimit } = this.state;
    console.log("currentLimits", lowerLimit, upperLimit);
    const ctx = this.canvasRef.getContext("2d");
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    ctx.fillStyle = "grey";
    ctx.strokeStyle = "coral";
    const maxValue = Math.max(...this.props.data);
    const downscaledData = this.props.data.map(
      value => (Math.log(value) / Math.log(maxValue)) * canvasHeight,
    );
    const activeRegion = new Path2D();
    ctx.beginPath();
    ctx.moveTo(0, downscaledData[0]);
    activeRegion.moveTo((lowerLimit / downscaledData.length) * canvasWidth, 0);
    for (let i = 1; i < downscaledData.length; i++) {
      const x = (i / downscaledData.length) * canvasWidth;
      if (i >= lowerLimit && i <= upperLimit) {
        activeRegion.lineTo(x, downscaledData[i]);
      }
      ctx.lineTo(x, downscaledData[i]);
    }
    ctx.stroke();
    ctx.closePath();
    activeRegion.lineTo((upperLimit / downscaledData.length) * canvasWidth, 0);
    activeRegion.lineTo((lowerLimit / downscaledData.length) * canvasWidth, 0);
    activeRegion.closePath();
    ctx.fill(activeRegion);
  }

  onThresholdChange = ([firstVal, secVal]) => {
    if (firstVal < secVal) {
      this.setState({ lowerLimit: firstVal, upperLimit: secVal });
    } else {
      this.setState({ lowerLimit: secVal, upperLimit: firstVal });
    }
    this.updateCanvas();
  };

  render() {
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
          min={0}
          max={255}
          range
          defaultValue={[0, this.props.data.length - 1]}
          onChange={this.onThresholdChange}
          style={{ width: 300, margin: 0, marginBottom: 18 }}
        />
      </React.Fragment>
    );
  }
}
