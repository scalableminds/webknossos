/**
 * tracing_settings_view.js
 * @flow
 */

import { Col, Collapse, Divider, Icon, Row, Select, Switch, Tag, Tooltip } from "antd";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import * as React from "react";
import _ from "lodash";

import type { APIDataset, APIHistogramData } from "admin/api_flow_types";
import {
  SwitchSetting,
  NumberSliderSetting,
  DropdownSetting,
  ColorSetting,
} from "oxalis/view/settings/setting_input_views";
import { findDataPositionForLayer, getHistogramForLayer } from "admin/admin_rest_api";
import { getMaxZoomValueForResolution } from "oxalis/model/accessors/flycam_accessor";
import { getGpuFactorsWithLabels } from "oxalis/model/bucket_data_handling/data_rendering_logic";
import { hasSegmentation, isRgb } from "oxalis/model/accessors/dataset_accessor";
import { setPositionAction, setZoomStepAction } from "oxalis/model/actions/flycam_actions";
import {
  updateDatasetSettingAction,
  updateLayerSettingAction,
  updateUserSettingAction,
} from "oxalis/model/actions/settings_actions";
import Store, {
  type DatasetConfiguration,
  type DatasetLayerConfiguration,
  type OxalisState,
  type UserConfiguration,
} from "oxalis/store";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import constants, {
  type ControlMode,
  ControlModeEnum,
  type ViewMode,
  type Vector3,
} from "oxalis/constants";
import Model from "oxalis/model";
import messages, { settings } from "messages";
import Histogram from "./histogram_view";

const { Panel } = Collapse;
const { Option } = Select;

type DatasetSettingsProps = {|
  userConfiguration: UserConfiguration,
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
  onChangeUser: (key: $Keys<UserConfiguration>, value: any) => void,
|};

type State = {
  histograms: { string: APIHistogramData },
};

class DatasetSettings extends React.PureComponent<DatasetSettingsProps, State> {
  state = {
    histograms: {},
  };

  componentDidMount() {
    this.loadAllHistograms();
  }

  loadAllHistograms = async () => {
    const { layers } = this.props.datasetConfiguration;
    const histograms: { string: APIHistogramData } = {};
    const histogramPromises = Object.keys(layers).map(async layerName => {
      const data = await getHistogramForLayer(
        this.props.dataset.dataStore.url,
        this.props.dataset,
        layerName,
      );
      histograms[layerName] = data;
      return data;
    });
    // Waiting for all Promises to be resolved.
    await Promise.all(histogramPromises);
    this.setState({ histograms });
  };

  getFindDataButton = (layerName: string, isDisabled: boolean) => (
    <Tooltip title="If you are having trouble finding your data, webKnossos can try to find a position which contains data.">
      <Icon
        type="scan"
        onClick={!isDisabled ? () => this.handleFindData(layerName) : () => {}}
        style={{
          float: "right",
          marginTop: 4,
          cursor: !isDisabled ? "pointer" : "not-allowed",
        }}
      />
    </Tooltip>
  );

  setVisibilityForAllLayers = (isVisible: boolean) => {
    const { layers } = this.props.datasetConfiguration;
    Object.keys(layers).forEach(otherLayerName =>
      this.props.onChangeLayer(otherLayerName, "isDisabled", !isVisible),
    );
  };

  isLayerExclusivelyVisible = (layerName: string): boolean => {
    const { layers } = this.props.datasetConfiguration;
    return Object.keys(layers).every(otherLayerName => {
      const { isDisabled } = layers[otherLayerName];
      return layerName === otherLayerName ? !isDisabled : isDisabled;
    });
  };

  getColorSettings = (
    [layerName, layer]: [string, DatasetLayerConfiguration],
    layerIndex: number,
    isLastLayer: boolean,
  ) => {
    const isRGB = isRgb(this.props.dataset, layerName);
    const { brightness, contrast, alpha, color, intensityRange, isDisabled } = layer;
    let histogram = new Array(256).fill(0);
    if (this.state.histograms && this.state.histograms[layerName]) {
      histogram = this.state.histograms[layerName].histogram;
    }

    return (
      <div key={layerName}>
        <Row>
          <Col span={24}>
            {/* TODO Maybe use the new antd icons instead of the switch when upgrading antd. */}
            <Tooltip title={isDisabled ? "Enable" : "Disable"} placement="top">
              {/* This div is necessary for the tooltip to be displayed */}
              <div style={{ display: "inline-block", marginRight: 8 }}>
                <Switch
                  size="small"
                  onChange={(val, event) => {
                    if (!event.ctrlKey) {
                      this.props.onChangeLayer(layerName, "isDisabled", !val);
                      return;
                    }
                    // If ctrl is pressed, toggle between "all layers visible" and
                    // "only selected layer visible".
                    if (this.isLayerExclusivelyVisible(layerName)) {
                      this.setVisibilityForAllLayers(true);
                    } else {
                      this.setVisibilityForAllLayers(false);
                      this.props.onChangeLayer(layerName, "isDisabled", false);
                    }
                  }}
                  checked={!isDisabled}
                />
              </div>
            </Tooltip>
            <span style={{ fontWeight: 700 }}>{layerName}</span>
            <Tag style={{ cursor: "default", marginLeft: 8 }} color={isRGB && "#1890ff"}>
              {isRGB ? "24-bit" : "8-bit"} Layer
            </Tag>
            {this.getFindDataButton(layerName, isDisabled)}
          </Col>
        </Row>
        {histogram != null ? (
          <Histogram
            data={histogram}
            min={intensityRange[0]}
            max={intensityRange[1]}
            layerName={layerName}
          />
        ) : null}
        <NumberSliderSetting
          label="Brightness"
          min={-255}
          max={255}
          step={5}
          value={brightness}
          onChange={_.partial(this.props.onChangeLayer, layerName, "brightness")}
          disabled={isDisabled}
        />
        <NumberSliderSetting
          label="Contrast"
          min={0.5}
          max={5}
          step={0.1}
          value={contrast}
          onChange={_.partial(this.props.onChangeLayer, layerName, "contrast")}
          disabled={isDisabled}
        />
        <NumberSliderSetting
          label="Opacity"
          min={0}
          max={100}
          value={alpha}
          onChange={_.partial(this.props.onChangeLayer, layerName, "alpha")}
          disabled={isDisabled}
        />
        <ColorSetting
          label="Color"
          value={Utils.rgbToHex(color)}
          onChange={_.partial(this.props.onChangeLayer, layerName, "color")}
          className="ant-btn"
          disabled={isDisabled}
        />
        {!isLastLayer && <Divider />}
      </div>
    );
  };

  onChangeGpuFactor = (gpuFactor: number) => {
    Toast.warning("Please reload the page to allow the changes to take effect.");
    this.props.onChangeUser("gpuMemoryFactor", gpuFactor);
  };

  handleFindData = async (layerName: string) => {
    const { dataset } = this.props;
    const { position, resolution } = await findDataPositionForLayer(
      dataset.dataStore.url,
      dataset,
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
    const segmentation = Model.getSegmentationLayer();
    const segmentationLayerName = segmentation != null ? segmentation.name : null;
    return (
      <Panel header="Segmentation" key="2">
        {segmentationLayerName ? (
          <div style={{ overflow: "auto" }}>
            {this.getFindDataButton(segmentationLayerName, false)}
          </div>
        ) : null}
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

        {this.props.controlMode === ControlModeEnum.VIEW || window.allowIsosurfaces ? (
          <SwitchSetting
            label="Render Isosurfaces (Beta)"
            value={this.props.datasetConfiguration.renderIsosurfaces}
            onChange={_.partial(this.props.onChange, "renderIsosurfaces")}
          />
        ) : null}
      </Panel>
    );
  }

  renderPanelHeader = (hasInvisibleLayers: boolean) =>
    hasInvisibleLayers ? (
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
    const hasInvisibleLayers =
      Object.keys(layers).find(
        layerName => layers[layerName].isDisabled || layers[layerName].alpha === 0,
      ) != null;

    return (
      <Collapse bordered={false} defaultActiveKey={["1", "2", "3", "4"]}>
        <Panel header={this.renderPanelHeader(hasInvisibleLayers)} key="1">
          {colorSettings}
        </Panel>
        {this.props.hasSegmentation ? this.getSegmentationPanel() : null}
        <Panel header="Data Rendering" key="3">
          <DropdownSetting
            label={
              <React.Fragment>
                {settings.gpuMemoryFactor}{" "}
                <Tooltip title="Adapt this setting to your hardware, so that rendering quality and speed are balanced. Medium is the default.">
                  <Icon type="info-circle" />
                </Tooltip>
              </React.Fragment>
            }
            value={(
              this.props.userConfiguration.gpuMemoryFactor || constants.DEFAULT_GPU_MEMORY_FACTOR
            ).toString()}
            onChange={this.onChangeGpuFactor}
          >
            {getGpuFactorsWithLabels().map(([factor, label]) => (
              <Option key={label} value={factor.toString()}>
                {label}
              </Option>
            ))}
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
  userConfiguration: state.userConfiguration,
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
  onChangeUser(propertyName, value) {
    dispatch(updateUserSettingAction(propertyName, value));
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
