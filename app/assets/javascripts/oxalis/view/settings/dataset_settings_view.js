/**
 * tracing_settings_view.js
 * @flow
 */

import type { Dispatch } from "redux";
import { Tooltip, Collapse, Row, Col, Select, Icon } from "antd";
import { connect } from "react-redux";
import * as React from "react";
import _ from "lodash";

import type { DatasetConfiguration, DatasetLayerConfiguration, OxalisState } from "oxalis/store";
import {
  SwitchSetting,
  NumberSliderSetting,
  DropdownSetting,
  ColorSetting,
} from "oxalis/view/settings/setting_input_views";
import {
  updateDatasetSettingAction,
  updateLayerSettingAction,
} from "oxalis/model/actions/settings_actions";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import constants, { type ControlMode, ControlModeEnum, type Mode } from "oxalis/constants";
import messages from "messages";

const Panel = Collapse.Panel;
const Option = Select.Option;

type DatasetSettingsProps = {
  datasetConfiguration: DatasetConfiguration,
  onChange: (propertyName: $Keys<DatasetConfiguration>, value: any) => void,
  onChangeLayer: (
    layerName: string,
    propertyName: $Keys<DatasetLayerConfiguration>,
    value: any,
  ) => void,
  viewMode: Mode,
  controlMode: ControlMode,
};

class DatasetSettings extends React.PureComponent<DatasetSettingsProps> {
  getColorSettings = (layer: Object, layerName: string) => (
    <div key={layerName}>
      <Row>
        <Col span={24}>Layer: {layerName}</Col>
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
    </div>
  );

  onChangeQuality = (propertyName: $Keys<DatasetConfiguration>, value: string) => {
    this.props.onChange(propertyName, parseInt(value));
  };

  onChangeRenderMissingDataBlack = (value: boolean): void => {
    Toast.warning(
      value
        ? messages["data.enabled_render_missing_data_black"]
        : messages["data.disabled_render_missing_data_black"],
      { timeout: 8000 },
    );
    this.props.onChange("renderMissingDataBlack", value);
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
          <SwitchSetting
            label="Highlight Hovered Cells"
            value={this.props.datasetConfiguration.highlightHoveredCellId}
            onChange={_.partial(this.props.onChange, "highlightHoveredCellId")}
          />
          {this.props.controlMode === ControlModeEnum.VIEW ? (
            <SwitchSetting
              label="Render Isosurfaces (Beta)"
              value={this.props.datasetConfiguration.renderIsosurfaces}
              onChange={_.partial(this.props.onChange, "renderIsosurfaces")}
            />
          ) : null}
        </Panel>
        <Panel header="Quality" key="3">
          <SwitchSetting
            label="4 Bit"
            value={this.props.datasetConfiguration.fourBit}
            onChange={_.partial(this.props.onChange, "fourBit")}
          />
          {constants.MODES_ARBITRARY.includes(this.props.viewMode) ? null : (
            <SwitchSetting
              label="Interpolation"
              value={this.props.datasetConfiguration.interpolation}
              onChange={_.partial(this.props.onChange, "interpolation")}
            />
          )}
          <DropdownSetting
            label="Quality"
            value={this.props.datasetConfiguration.quality}
            onChange={_.partial(this.onChangeQuality, "quality")}
          >
            <Option value="0">high</Option>
            <Option value="1">medium</Option>
            <Option value="2">low</Option>
          </DropdownSetting>
          <SwitchSetting
            label={
              <React.Fragment>
                Render Missing Data Black{" "}
                <Tooltip title="Upsample lower resolution data for missing higher resolution data.">
                  <Icon type="info-circle" />
                </Tooltip>
              </React.Fragment>
            }
            value={this.props.datasetConfiguration.renderMissingDataBlack}
            onChange={this.onChangeRenderMissingDataBlack}
          />
        </Panel>
      </Collapse>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  datasetConfiguration: state.datasetConfiguration,
  viewMode: state.temporaryConfiguration.viewMode,
  controlMode: state.temporaryConfiguration.controlMode,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onChange(propertyName, value) {
    dispatch(updateDatasetSettingAction(propertyName, value));
  },
  onChangeLayer(layerName, propertyName, value) {
    dispatch(updateLayerSettingAction(layerName, propertyName, value));
  },
});

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(DatasetSettings);
