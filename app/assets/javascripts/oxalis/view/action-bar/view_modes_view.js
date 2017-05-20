// @flow
import React, { PureComponent } from "react";
import constants from "oxalis/constants";
import type { ModeType } from "oxalis/constants";
import { Radio } from "antd";
import { setViewModeAction } from "oxalis/model/actions/settings_actions";
import type { OxalisState } from "oxalis/store";
import Store from "oxalis/store";
import { connect } from "react-redux";

class ViewModesView extends PureComponent {
  props: {
    viewMode: ModeType,
  }

  _forceUpdate = () => { this.forceUpdate(); };

  blurElement = (event: SyntheticInputEvent) => {
    event.target.blur();
  }

  handleChange = (event: { target: { value: ModeType } }) => {
    Store.dispatch(setViewModeAction(event.target.value));
  };

  render() {
    const viewMode = this.props.viewMode;
    return (
      <Radio.Group onChange={this.handleChange} value={this.props.oldModel.get("mode")} size="large">
        <Radio.Button onClick={this.blurElement} value={constants.MODE_PLANE_TRACING}>Orthogonal</Radio.Button>
        <Radio.Button onClick={this.blurElement} value={constants.MODE_ARBITRARY}>Flight</Radio.Button>
        <Radio.Button onClick={this.blurElement} value={constants.MODE_ARBITRARY_PLANE}>Oblique</Radio.Button>
      </Radio.Group>
    );
  }
}

function mapStateToProps(state: OxalisState) {
  return {
    viewMode: state.temporaryConfiguration.viewMode,
  };
}

export default connect(mapStateToProps)(ViewModesView);
