/**
 * tracing_settings_view.js
 * @flow
 */

import _ from "lodash";
import React, { Component } from "react";
import { connect } from "react-redux";
import { Collapse } from "antd";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { SwitchSetting, NumberSliderSetting } from "./setting_input_views";

const Panel = Collapse.Panel;

class UserSettingsView extends Component {

  render() {
    return (
      <Collapse defaultActiveKey={["1", "2", "3", "4"]}>
        <Panel header="Controls" key="1">
          <SwitchSetting label="Inverse X" value={this.props.inverseX} onChange={_.partial(this.props.onChange, "inverseX")} />
          <SwitchSetting label="Inverse Y" value={this.props.inverseY} onChange={_.partial(this.props.onChange, "inverseY")} />
          <NumberSliderSetting label="Keyboard delay (ms)" min={0} max={500} value={this.props.keyboardDelay} onChange={_.partial(this.props.onChange, "keyboardDelay")} />
        </Panel>
        <Panel header="Viewport Options" key="2">
          <NumberSliderSetting label="Move Value (nm/s)" min={30} max={14000} step={10} value={this.props.moveValue} onChange={_.partial(this.props.onChange, "moveValue")} />
          <NumberSliderSetting label="Zoom" min={-100} max={100} value={this.props.zoom} onChange={_.partial(this.props.onChange, "zoom")} />
          <NumberSliderSetting label="Viewport Scale" min={0.05} max={20} step={0.1} value={this.props.scale} onChange={_.partial(this.props.onChange, "scale")} />
          <NumberSliderSetting label="Clipping Distance" max={12000} value={this.props.clippingDistance} onChange={_.partial(this.props.onChange, "clippingDistance")} />
          <SwitchSetting label="d/f-Switching" value={this.props.dynamicSpaceDirection} onChange={_.partial(this.props.onChange, "dynamicSpaceDirection")} />
          <SwitchSetting label="Show Crosshairs" value={this.props.displayCrosshair} onChange={_.partial(this.props.onChange, "displayCrosshair")} />
        </Panel>
        <Panel header="3D View" key="3">
          <SwitchSetting label="Display Planes" value={this.props.tdViewDisplayPlanes} onChange={_.partial(this.props.onChange, "tdViewDisplayPlanes")} />
        </Panel>
        <Panel header="Abstract Tree" key="4">
          <SwitchSetting label="Render Comments" value={this.props.renderComments} onChange={_.partial(this.props.onChange, "renderComments")} />
        </Panel>
      </Collapse>
    );
  }
}

const mapStateToProps = state => (
  state.userConfiguration
);

const mapDispatchToProps = dispatch => ({
  onChange(propertyName, value) { dispatch(updateUserSettingAction(propertyName, value)); },
});

export default connect(mapStateToProps, mapDispatchToProps)(UserSettingsView);
