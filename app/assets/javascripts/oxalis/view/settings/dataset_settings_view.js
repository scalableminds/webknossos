/**
 * tracing_settings_view.js
 * @flow
 */

import _ from "lodash";
import React, { Component } from "react";
import { connect } from "react-redux";
import { Collapse } from "antd";
import { updateSettingAction, updateLayerSettingAction } from "oxalis/model/actions/settings_actions";
import { SwitchSetting, NumberSliderSetting } from "./setting_input_views";

const Panel = Collapse.Panel;

class DatasetSettings extends Component {

  getColorSettings(layerName) {
    const layer = this.props.layers[layerName];
    return (
      <div>
        <Row>
          <Col span={24}>{layerName}</Col>
        </Row>
        <NumberSliderSetting label="Brightness" min={0} max={500} value={layer.brightness} onChange={_.partial(this.props.onChange, "keyboardDelay")} />
        <NumberSliderSetting label="Contrast" min={0} max={500} value={layer.contrast} onChange={_.partial(this.props.onChange, "keyboardDelay")} />
        <ColorSetting />
      </div>
    )
  }

  render() {

    const colorSettings = this.props.dataLayerNames.map(this.getColorSettings);

    return (
      <Collapse defaultActiveKey={["1", "2", "3", "4"]}>
        <Panel header="Colors" key="1">
          {colorSettings}
        </Panel>
        <Panel header="Quality" key="2">
          <SwitchSetting label="4 Bit" value={this.props.fourBit} onChange={_.partial(this.props.onChange, "fourBit")} />
          <SwitchSetting label="Interpolation" value={this.props.interpolation} onChange={_.partial(this.props.onChange, "interpolation")} />
          <DropdownSetting label="Quality" value={this.props.quality} onChange={_.partial(this.props.onChange, "quality")} />
        </Panel>
      </Collapse>
    );
  }
}

const mapStateToProps = state => (
  state.datasetConfiguration
);

const mapDispatchToProps = dispatch => ({
  onChange(propertyName, value) { dispatch(updateSettingAction(propertyName, value)); },
  onChangeLayerColor(layerName, propertyName, value) { dispatch(updateLayerSettingAction(layerName, propertyName, value)); },
});

export default connect(mapStateToProps, mapDispatchToProps)(DatasetSettings);
