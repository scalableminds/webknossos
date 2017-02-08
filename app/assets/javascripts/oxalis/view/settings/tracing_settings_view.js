/**
 * tracing_settings_view.js
 * @flow
 */

import _ from "lodash";
import React, { Component } from "react";
import { connect } from "react-redux";
import { Collapse } from "antd";
import { updateSettingAction } from "oxalis/model/actions/settings_actions";
import { deleteActiveNodeAction } from "oxalis/model/actions/skeleton_actions";
import { NumberInputSetting, SwitchSetting, NumberSliderSetting, ButtonSetting, BoundingBoxSetting } from "./setting_input_views";

const Panel = Collapse.Panel;

class TracingSettingsView extends Component {

  render() {
    return (
      <Collapse defaultActiveKey={["1", "2", "3", "4"]}>
        <Panel header="Trees" key="1">
          <NumberInputSetting label="Active Tree ID" max={5000} value={this.props.activeTreeId} onChange={_.partial(this.props.onChange, "activeTreeId")} />
          <SwitchSetting label="Soma Clicking" value={this.props.somaClickingAllowed} onChange={_.partial(this.props.onChange, "somaClickingAllowed")} />
        </Panel>
        <Panel header="Nodes" key="2">
          <NumberInputSetting label="Active Node ID" max={5000} value={this.props.activeNodeId} onChange={_.partial(this.props.onChange, "activeNodeId")} />
          <NumberSliderSetting label="Radius" max={5000} value={this.props.radius} onChange={_.partial(this.props.onChange, "radius")} />
          <NumberSliderSetting label="Particle Size" max={20} step={0.1} value={this.props.particleSize} onChange={_.partial(this.props.onChange, "particleSize")} />
          <SwitchSetting label="Override Radius" value={this.props.overrideNodeRadius} onChange={_.partial(this.props.onChange, "overrideNodeRadius")} />
        </Panel>
        <Panel header="Trees" key="3">
          <ButtonSetting label="Delete Active Node" onClick={this.props.handleDeleteActiveNode} />
        </Panel>
        <Panel header="Bounding Box" key="4">
          <BoundingBoxSetting label="Bounding Box" value={this.props.boundingBox} onChange={_.partial(this.props.onChange, "boundingBox")} />
        </Panel>
      </Collapse>
    );
  }
}

const mapStateToProps = state => (
  state.userConfiguration
);

const mapDispatchToProps = dispatch => ({
  onChange(propertyName, value) { dispatch(updateSettingAction(propertyName, value)); },
  handleDeleteActiveNode() { dispatch(deleteActiveNodeAction); },
});

export default connect(mapStateToProps, mapDispatchToProps)(TracingSettingsView);
