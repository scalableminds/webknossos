/**
 * tracing_settings_view.js
 * @flow
 */

import _ from "lodash";
import React, { Component } from "react";
import { connect } from "react-redux";
import { Collapse, Row, Col, Select } from "antd";
import { updateDatasetSettingAction, updateLayerSettingAction } from "oxalis/model/actions/settings_actions";
import { SwitchSetting, NumberSliderSetting, DropdownSetting } from "./setting_input_views";

const Panel = Collapse.Panel;
const Option = Select.Option;

class DatasetSettings extends Component {

  getColorSettings = (layerName, i) => {
    const layer = this.props.layers[layerName];
    // <ColorSetting label="Color"/>
    return (
      <div key={i}>
        <Row>
          <Col span={24}><label>{layerName}</label></Col>
        </Row>
        <NumberSliderSetting label="Brightness" min={-255} max={255} step={5} value={layer.brightness} onChange={_.partial(this.props.onChangeLayer, layerName, "brightness")} />
        <NumberSliderSetting label="Contrast" min={0.5} max={5} step={0.1} value={layer.contrast} onChange={_.partial(this.props.onChangeLayer, layerName, "contrast")} />
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
          <DropdownSetting label="Quality" value={this.props.quality} onChange={_.partial(this.props.onChange, "quality")} >
            <Option value="0">high</Option>
            <Option value="1">medium</Option>
            <Option value="2">low</Option>
          </DropdownSetting>
        </Panel>
      </Collapse>
    );
  }
}

const mapStateToProps = state => (
  state.datasetConfiguration
);

const mapDispatchToProps = dispatch => ({
  onChange(propertyName, value) { dispatch(updateDatasetSettingAction(propertyName, value)); },
  onChangeLayer(layerName, propertyName, value) { dispatch(updateLayerSettingAction(layerName, propertyName, value)); },
});

export default connect(mapStateToProps, mapDispatchToProps)(DatasetSettings);
