// @flow
import React, { PureComponent } from "react";
import type Model from "oxalis/model";
import Constants from "oxalis/constants";
import { Button, Radio } from "antd";

class VolumeActionsView extends PureComponent {
  props: {
    oldModel: Model,
  };

  componentDidMount() {
    this.props.oldModel.volumeTracing.on("change:mode", this._forceUpdate);
  }

  componentWillUnmount() {
    this.props.oldModel.volumeTracing.off("change:mode", this._forceUpdate);
  }

  _forceUpdate = () => { this.forceUpdate(); };

  render() {
    return (
      <div>
        <Radio.Group
          onChange={event => this.props.oldModel.volumeTracing.setMode(event.target.value)}
          value={this.props.oldModel.volumeTracing.mode}
          style={{ marginRight: 10 }}
        >
          <Radio.Button value={Constants.VOLUME_MODE_MOVE}>Move</Radio.Button>
          <Radio.Button value={Constants.VOLUME_MODE_TRACE}>Trace</Radio.Button>
        </Radio.Group>
        <Button.Group>
          <Button
            onClick={() => { this.props.oldModel.volumeTracing.createCell(); }}
          >Create new cell (C)</Button>
        </Button.Group>
      </div>
    );
  }
}

export default VolumeActionsView;
