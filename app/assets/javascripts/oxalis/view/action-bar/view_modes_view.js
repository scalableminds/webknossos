// @flow
import React, { PureComponent } from "react";
import type Model from "oxalis/model";
import constants from "oxalis/constants";
import type { ModeType } from "oxalis/constants";
import { Radio } from "antd";

class ViewModesView extends PureComponent {
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

  blurElement = (event: SyntheticInputEvent) => {
    event.target.blur();
  }

  handleChange = (event: { target: { value: ModeType } }) => {
    this.props.oldModel.setMode(event.target.value);
  };

  render() {
    return (
      <Radio.Group onChange={this.handleChange} value={this.props.oldModel.get("mode")} size="large">
        <Radio.Button onClick={this.blurElement} value={constants.MODE_PLANE_TRACING}>Orthogonal</Radio.Button>
        <Radio.Button onClick={this.blurElement} value={constants.MODE_ARBITRARY}>Flight</Radio.Button>
        <Radio.Button onClick={this.blurElement} value={constants.MODE_ARBITRARY_PLANE}>Oblique</Radio.Button>
      </Radio.Group>
    );
  }
}

export default ViewModesView;
