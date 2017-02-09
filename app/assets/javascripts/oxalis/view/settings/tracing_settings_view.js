/**
 * tracing_settings_view.js
 * @flow
 */

import _ from "lodash";
import React, { Component } from "react";
import { connect } from "react-redux";
import { Collapse } from "antd";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { NumberInputSetting, SwitchSetting, NumberSliderSetting, BoundingBoxSetting } from "./setting_input_views";

const Panel = Collapse.Panel;

class TracingSettingsView extends Component {

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
          <NumberSliderSetting label="Zoom" min={-100} max={100} value={this.props.zoom || 0} onChange={_.partial(this.props.onChange, "zoom")} />
          <NumberSliderSetting label="Viewport Scale" min={0.05} max={20} step={0.1} value={this.props.scale} onChange={_.partial(this.props.onChange, "scale")} />
          <NumberSliderSetting label="Clipping Distance" max={12000} value={this.props.clippingDistance} onChange={_.partial(this.props.onChange, "clippingDistance")} />
          <SwitchSetting label="d/f-Switching" value={this.props.dynamicSpaceDirection} onChange={_.partial(this.props.onChange, "dynamicSpaceDirection")} />
          <SwitchSetting label="Show Crosshairs" value={this.props.displayCrosshair} onChange={_.partial(this.props.onChange, "displayCrosshair")} />
        </Panel>
        <Panel header="Nodes & Trees" key="3">
          <NumberInputSetting label="Active Node ID" max={5000} value={this.props.activeNodeId} onChange={_.partial(this.props.onChange, "activeNodeId")} />
          <NumberInputSetting label="Active Tree ID" max={5000} value={this.props.activeTreeId} onChange={_.partial(this.props.onChange, "activeTreeId")} />
          <NumberSliderSetting label="Radius" max={5000} value={this.props.radius} onChange={_.partial(this.props.onChange, "radius")} />
          <NumberSliderSetting label="Particle Size" max={20} step={0.1} value={this.props.particleSize} onChange={_.partial(this.props.onChange, "particleSize")} />
          <SwitchSetting label="Soma Clicking" value={this.props.newNodeNewTree} onChange={_.partial(this.props.onChange, "newNodeNewTree")} />
          <SwitchSetting label="Override Radius" value={this.props.overrideNodeRadius} onChange={_.partial(this.props.onChange, "overrideNodeRadius")} />
        </Panel>
        <Panel header="Flight Options" key="4">
          <NumberInputSetting label="Mouse Rotation" min={0.0001} max={0.02} step={0.001} value={this.props.mouseRotateValue} onChange={_.partial(this.props.onChange, "mouseRotateValue")} />
          <NumberInputSetting label="Keyboard Rotation Value" min={0.001} max={0.08} step={0.001} value={this.props.activeNodeId} onChange={_.partial(this.props.onChange, "activeNodeId")} />
          <NumberInputSetting label="Move Value (nm/s)" min={30} max={1500} step={10} value={this.props.moveValue3d} onChange={_.partial(this.props.onChange, "moveValue3d")} />
          <NumberInputSetting label="Crosshair Size" min={0.05} max={0.5} step={0.01} value={this.props.crosshairSize} onChange={_.partial(this.props.onChange, "crosshairSize")} />
          <NumberInputSetting label="Sphere Radius" min={50} max={500} step={1} value={this.props.sphericalCapRadius} onChange={_.partial(this.props.onChange, "sphericalCapRadius")} />
          <NumberInputSetting label="Clipping Distance" max={127} value={this.props.clippingDistanceArbitrary} onChange={_.partial(this.props.onChange, "clippingDistanceArbitrary")} />
          <SwitchSetting label="Show Crosshair" value={this.props.displayCrosshair} onChange={_.partial(this.props.onChange, "displayCrosshair")} />
        </Panel>
        <Panel header="Other" key="5">
          <BoundingBoxSetting label="Bounding Box" value={this.props.boundingBox} onChange={_.partial(this.props.onChange, "boundingBox")} />
          <SwitchSetting label="Display Planes in 3D View" value={this.props.tdViewDisplayPlanes} onChange={_.partial(this.props.onChange, "tdViewDisplayPlanes")} />
          <SwitchSetting label="Render Comments in Abstract Tree" value={this.props.renderComments} onChange={_.partial(this.props.onChange, "renderComments")} />
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

export default connect(mapStateToProps, mapDispatchToProps)(TracingSettingsView);
