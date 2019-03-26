/**
 * tracing_settings_view.js
 * @flow
 */

import { Col, Collapse, Divider, Icon, Row, Select, Tag, Tooltip } from "antd";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import * as React from "react";
import _ from "lodash";

import type { APIDataset } from "admin/api_flow_types";
import {
  SwitchSetting,
  NumberSliderSetting,
  DropdownSetting,
  ColorSetting,
} from "oxalis/view/settings/setting_input_views";
import { findDataPositionForLayer } from "admin/admin_rest_api";
import { getMaxZoomValueForResolution } from "oxalis/model/accessors/flycam_accessor";
import { hasSegmentation, isRgb } from "oxalis/model/accessors/dataset_accessor";
import { setPositionAction, setZoomStepAction } from "oxalis/model/actions/flycam_actions";
import {
  updateDatasetSettingAction,
  updateLayerSettingAction,
} from "oxalis/model/actions/settings_actions";
import Store, {
  type DatasetConfiguration,
  type DatasetLayerConfiguration,
  type OxalisState,
} from "oxalis/store";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import constants, {
  type ControlMode,
  ControlModeEnum,
  type ViewMode,
  type Vector3,
} from "oxalis/constants";
import messages, { settings } from "messages";

const { Panel } = Collapse;
const { Option } = Select;

type DatasetSettingsProps = {|
  datasetConfiguration: DatasetConfiguration,
  dataset: APIDataset,
  onChange: (propertyName: $Keys<DatasetConfiguration>, value: any) => void,
  onChangeLayer: (
    layerName: string,
    propertyName: $Keys<DatasetLayerConfiguration>,
    value: any,
  ) => void,
  viewMode: ViewMode,
  controlMode: ControlMode,
  hasSegmentation: boolean,
  onSetPosition: Vector3 => void,
  onZoomToResolution: Vector3 => number,
|};

class DatasetSettings extends React.PureComponent<DatasetSettingsProps> {
  getColorSettings = (
    [layerName, layer]: [string, DatasetLayerConfiguration],
    layerIndex: number,
    isLastLayer: boolean,
  ) => {
    const isRGB = isRgb(this.props.dataset, layerName);
    const { brightness, contrast, alpha, color, isDisabled } = layer;
    return (
      <div key={layerName}>
        <Row>
          <Col span={24}>
            <span style={{ fontWeight: 700 }}>{layerName}</span>
            <Tag style={{ cursor: "default", marginLeft: 8 }} color={isRGB && "#1890ff"}>
              {isRGB ? "24-bit" : "8-bit"} Layer
            </Tag>
            {/* TODO change adjust types of the icons when upgrading antd. */}
            <Tooltip title={isDisabled ? "Hide" : "Show"}>
              <Icon
                type={isDisabled ? "eye" : "eye-o"}
                onClick={() => this.props.onChangeLayer(layerName, "isDisabled", !isDisabled)}
                style={{ marginTop: 4, marginLeft: 8, cursor: "pointer" }}
              />
            </Tooltip>
            <Tooltip title="If you are having trouble finding your data, webKnossos can try to find a position which contains data.">
              <Icon
                type="scan"
                onClick={() => this.handleFindData(layerName)}
                style={{ float: "right", marginTop: 4, cursor: "pointer" }}
              />
            </Tooltip>
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

  handleFindData = async (layerName: string) => {
    const { position, resolution } = await findDataPositionForLayer(
      this.props.dataset.dataStore.url,
      this.props.dataset,
      layerName,
    );
    if (!position || !resolution) {
      Toast.warning(`Couldn't find data within layer "${layerName}."`);
      return;
    }

    this.props.onSetPosition(position);
    const zoomValue = this.props.onZoomToResolution(resolution);
    Toast.success(
      `Jumping to position ${position.join(", ")} and zooming to ${zoomValue.toFixed(2)}`,
    );
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

  renderPanelHeader = (hasDisabledLayers: boolean) =>
    hasDisabledLayers ? (
      <span>
        Color Layers
        <Tooltip title="Not all layers are currently visible.">
          <Icon type="exclamation-circle-o" style={{ marginLeft: 16, color: "coral" }} />
        </Tooltip>
      </span>
    ) : (
      "Color Layers"
    );

  render() {
    const { layers } = this.props.datasetConfiguration;
    const colorSettings = Object.entries(layers).map((entry, index) =>
      // $FlowFixMe Object.entries returns mixed for Flow
      this.getColorSettings(entry, index, index === _.size(layers) - 1),
    );
    const hasDisabledLayers =
      Object.keys(layers).find(layerName => !layers[layerName].isDisabled) != null;
      console.log("hasDisbaledLayers", hasDisabledLayers);
    return (
      <Collapse bordered={false} defaultActiveKey={["1", "2", "3", "4"]}>
        <Panel header={this.renderPanelHeader(hasDisabledLayers)} key="1">
          {colorSettings}
        </Panel>
        {this.props.hasSegmentation ? this.getSegmentationPanel() : null}
        <Panel header="Data Rendering" key="3">
          <DropdownSetting
            label={settings.quality}
            value={this.props.datasetConfiguration.quality}
            onChange={_.partial(this.onChangeQuality, "quality")}
          >
            <Option value="0">High</Option>
            <Option value="1">Medium</Option>
            <Option value="2">Low</Option>
          </DropdownSetting>
          <DropdownSetting
            label={
              <React.Fragment>
                {settings.loadingStrategy}{" "}
                <Tooltip title={settings.loadingStrategyDescription}>
                  <Icon type="info-circle" />
                </Tooltip>
              </React.Fragment>
            }
            value={this.props.datasetConfiguration.loadingStrategy}
            onChange={_.partial(this.props.onChange, "loadingStrategy")}
          >
            <Option value="BEST_QUALITY_FIRST">Best quality first</Option>
            <Option value="PROGRESSIVE_QUALITY">Progressive quality</Option>
          </DropdownSetting>
          <SwitchSetting
            label={
              <React.Fragment>
                {settings.fourBit}{" "}
                <Tooltip title="Decrease size of transferred data by half using lossy compression. Recommended for poor and/or capped Internet connections.">
                  <Icon type="info-circle" />
                </Tooltip>
              </React.Fragment>
            }
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
          <SwitchSetting
            label={
              <React.Fragment>
                {settings.renderMissingDataBlack}{" "}
                <Tooltip title="If disabled, missing data will be rendered by using poorer magnifications.">
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
  onSetPosition(position) {
    dispatch(setPositionAction(position));
  },
  onZoomToResolution(resolution) {
    const targetZoomValue = getMaxZoomValueForResolution(Store.getState(), resolution);
    dispatch(setZoomStepAction(targetZoomValue));
    return targetZoomValue;
  },
});

export default connect<DatasetSettingsProps, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(DatasetSettings);
