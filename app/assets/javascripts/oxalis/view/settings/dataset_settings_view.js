/**
 * tracing_settings_view.js
 * @flow
 */

import type { Dispatch } from "redux";
import { Tooltip, Collapse, Row, Col, Select, Icon, Divider, Tag } from "antd";
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
import { hasSegmentation, isRgb } from "oxalis/model/accessors/dataset_accessor";
import {
  updateDatasetSettingAction,
  updateLayerSettingAction,
} from "oxalis/model/actions/settings_actions";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import constants, { type ControlMode, ControlModeEnum, type Mode } from "oxalis/constants";
import messages, { settings } from "messages";
import type { APIDataset } from "admin/api_flow_types";

const Panel = Collapse.Panel;
const Option = Select.Option;

type DatasetSettingsProps = {
  datasetConfiguration: DatasetConfiguration,
  dataset: APIDataset,
  onChange: (propertyName: $Keys<DatasetConfiguration>, value: any) => void,
  onChangeLayer: (
    layerName: string,
    propertyName: $Keys<DatasetLayerConfiguration>,
    value: any,
  ) => void,
  viewMode: Mode,
  controlMode: ControlMode,
  hasSegmentation: boolean,
};

class DatasetSettings extends React.PureComponent<DatasetSettingsProps> {
  getColorSettings = (
    [layerName: string, layer: DatasetLayerConfiguration],
    layerIndex: number,
    isLastLayer: boolean,
  ) => {
    const isRGB = isRgb(this.props.dataset, layerName);
    // $FlowFixMe Object.entries returns mixed for Flow
    const { brightness, contrast, alpha, color } = layer;
    return (
      <div key={layerName}>
        <Row>
          <Col span={24}>
            {layerName}
            <Tag style={{ cursor: "default", marginLeft: 8 }} color={isRGB && "#1890ff"}>
              {isRGB ? "24-bit" : "8-bit"} Layer
            </Tag>
          </Col>
        </Row>
        <NumberSliderSetting
          label="Brightness"
          min={-255}
          max={255}
          step={5}
          value={brightness}
          onChange={_.partial(this.props.onChangeLayer, layerName, "brightness")}
        />
        <NumberSliderSetting
          label="Contrast"
          min={0.5}
          max={5}
          step={0.1}
          value={contrast}
          onChange={_.partial(this.props.onChangeLayer, layerName, "contrast")}
        />
        <NumberSliderSetting
          label="Opacity"
          min={0}
          max={100}
          value={alpha}
          onChange={_.partial(this.props.onChangeLayer, layerName, "alpha")}
        />
        <ColorSetting
          label="Color"
          value={Utils.rgbToHex(color)}
          onChange={_.partial(this.props.onChangeLayer, layerName, "color")}
          className="ant-btn"
        />
        {!isLastLayer && <Divider />}
      </div>
    );
  };

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

  getSegmentationPanel() {
    return (
      <Panel header="Segmentation" key="2">
        <NumberSliderSetting
          label={settings.segmentationOpacity}
          min={0}
          max={100}
          value={this.props.datasetConfiguration.segmentationOpacity}
          onChange={_.partial(this.props.onChange, "segmentationOpacity")}
        />
        <SwitchSetting
          label={settings.highlightHoveredCellId}
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
    );
  }

  render() {
    const { layers } = this.props.datasetConfiguration;
    const colorSettings = Object.entries(layers).map((entry, index) =>
      this.getColorSettings(entry, index, index === _.size(layers) - 1),
    );

    return (
      <Collapse defaultActiveKey={["1", "2", "3", "4"]}>
        <Panel header="Color Layers" key="1">
          {colorSettings}
        </Panel>
        {this.props.hasSegmentation ? this.getSegmentationPanel() : null}
        <Panel header="Quality" key="3">
          <SwitchSetting
            label={settings.fourBit}
            value={this.props.datasetConfiguration.fourBit}
            onChange={_.partial(this.props.onChange, "fourBit")}
          />
          {constants.MODES_ARBITRARY.includes(this.props.viewMode) ? null : (
            <SwitchSetting
              label={settings.interpolation}
              value={this.props.datasetConfiguration.interpolation}
              onChange={_.partial(this.props.onChange, "interpolation")}
            />
          )}
          <DropdownSetting
            label={settings.quality}
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
                {settings.renderMissingDataBlack}{" "}
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
  dataset: state.dataset,
  hasSegmentation: hasSegmentation(state.dataset),
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
