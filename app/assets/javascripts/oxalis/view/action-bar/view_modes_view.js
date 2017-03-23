// @flow
import React, { Component } from "react";
import type Model from "oxalis/model";
import constants from "oxalis/constants";
import type { ModeType } from "oxalis/constants";
import { Radio } from "antd";

class ViewModesView extends Component {
  props: {
    oldModel: Model,
  };

  componentDidMount() {
    this.props.oldModel.on("change:mode", this._forceUpdate);
  }

  componentWillUnmount() {
    this.props.oldModel.off("change:mode", this._forceUpdate);
  }

  _forceUpdate = () => { this.forceUpdate(); };

  handleChange = (event: { target: { value: ModeType } }) => {
    this.props.oldModel.setMode(event.target.value);
  };

  render() {
    return (
      <Radio.Group onChange={this.handleChange} value={this.props.oldModel.get("mode")}>
        <Radio.Button value={constants.MODE_PLANE_TRACING}>Orthogonal</Radio.Button>
        <Radio.Button value={constants.MODE_ARBITRARY}>Flight</Radio.Button>
        <Radio.Button value={constants.MODE_ARBITRARY_PLANE}>Oblique</Radio.Button>
      </Radio.Group>
    );
  }
}

export default ViewModesView;
