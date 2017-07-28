/**
 * tracing_settings_view.js
 * @flow
 */

import _ from "lodash";
import React, { Component } from "react";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import { Collapse, Row, Col, Select } from "antd";
import type {
  DatasetConfigurationType,
  DatasetLayerConfigurationType,
  OxalisState,
} from "oxalis/store";
import {
  updateDatasetSettingAction,
  updateLayerSettingAction,
} from "oxalis/model/actions/settings_actions";
import {
  SwitchSetting,
  NumberSliderSetting,
  DropdownSetting,
  ColorSetting,
} from "oxalis/view/settings/setting_input_views";
import Utils from "libs/utils";

const Panel = Collapse.Panel;
const Option = Select.Option;

type DatasetSettingsProps = {
  datasetConfiguration: DatasetConfigurationType,
  onChange: (propertyName: $Keys<DatasetConfigurationType>, value: any) => void,
  onChangeLayer: (
    layerName: string,
    propertyName: $Keys<DatasetLayerConfigurationType>,
    value: any,
  ) => void,
};

class DatasetSettings extends Component {
  props: DatasetSettingsProps;

  shouldComponentUpdate(nextProps: DatasetSettingsProps) {
    return this.props.datasetConfiguration !== nextProps.datasetConfiguration;
  }

  getColorSettings = (layer: Object, layerName: string) =>
    <div key={layerName}>
      <Row>
        <Col span={24}>
          Layer: {layerName}
        </Col>
      </Row>
      <NumberSliderSetting
        label="Brightness"
        min={-255}
        max={255}
        step={5}
        value={layer.brightness}
        onChange={_.partial(this.props.onChangeLayer, layerName, "brightness")}
      />
      <NumberSliderSetting
        label="Contrast"
        min={0.5}
        max={5}
        step={0.1}
        value={layer.contrast}
        onChange={_.partial(this.props.onChangeLayer, layerName, "contrast")}
      />
      <ColorSetting
        label="Color"
        value={Utils.rgbToHex(layer.color)}
        onChange={_.partial(this.props.onChangeLayer, layerName, "color")}
        className="ant-btn"
      />
    </div>;

  onChangeQuality = (propertyName: $Keys<DatasetConfigurationType>, value: string) => {
    this.props.onChange(propertyName, parseInt(value));
  };

  render() {
    const colorSettings = _.map(this.props.datasetConfiguration.layers, this.getColorSettings);

    return (
      <Collapse defaultActiveKey={["1", "2", "3", "4"]}>
        <Panel header="Colors" key="1">
          {colorSettings}
        </Panel>
        <Panel header="Segmentation" key="2">
          <NumberSliderSetting
            label="Segmentation Opacity"
            min={0}
            max={100}
            value={this.props.datasetConfiguration.segmentationOpacity}
            onChange={_.partial(this.props.onChange, "segmentationOpacity")}
          />
        </Panel>
        <Panel header="Quality" key="3">
          <SwitchSetting
            label="4 Bit"
            value={this.props.datasetConfiguration.fourBit}
            onChange={_.partial(this.props.onChange, "fourBit")}
          />
          <SwitchSetting
            label="Interpolation"
            value={this.props.datasetConfiguration.interpolation}
            onChange={_.partial(this.props.onChange, "interpolation")}
          />
          <DropdownSetting
            label="Quality"
            value={this.props.datasetConfiguration.quality}
            onChange={_.partial(this.onChangeQuality, "quality")}
          >
            <Option value="0">high</Option>
            <Option value="1">medium</Option>
            <Option value="2">low</Option>
          </DropdownSetting>
        </Panel>
      </Collapse>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  datasetConfiguration: state.datasetConfiguration,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onChange(propertyName, value) {
    dispatch(updateDatasetSettingAction(propertyName, value));
  },
  onChangeLayer(layerName, propertyName, value) {
    dispatch(updateLayerSettingAction(layerName, propertyName, value));
  },
});

export default connect(mapStateToProps, mapDispatchToProps)(DatasetSettings);
