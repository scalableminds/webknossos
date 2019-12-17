/**
 * tracing_settings_view.js
 * @flow
 */

import { Col, Collapse, Icon, Row, Select, Switch, Tag, Tooltip } from "antd";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import * as React from "react";
import _ from "lodash";
import { V3 } from "libs/mjs";

import type { APIDataset, APIHistogramData } from "admin/api_flow_types";
import { AsyncIconButton } from "components/async_clickables";
import {
  SwitchSetting,
  NumberSliderSetting,
  DropdownSetting,
  ColorSetting,
} from "oxalis/view/settings/setting_input_views";
import { findDataPositionForLayer, getHistogramForLayer } from "admin/admin_rest_api";
import { getGpuFactorsWithLabels } from "oxalis/model/bucket_data_handling/data_rendering_logic";
import { getMaxZoomValueForResolution } from "oxalis/model/accessors/flycam_accessor";
import {
  hasSegmentation,
  getElementClass,
  getLayerBoundaries,
} from "oxalis/model/accessors/dataset_accessor";
import { setPositionAction, setZoomStepAction } from "oxalis/model/actions/flycam_actions";
import {
  updateDatasetSettingAction,
  updateLayerSettingAction,
  updateUserSettingAction,
} from "oxalis/model/actions/settings_actions";
import Model from "oxalis/model";
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
import messages, { settings } from "messages";

import Histogram, { isHistogramSupported } from "./histogram_view";

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

  getFindDataButton = (layerName: string, isDisabled: boolean, isColorLayer: boolean) => {
    let tooltipText = isDisabled
      ? "You cannot search for data when the layer is disabled."
      : "If you are having trouble finding your data, webKnossos can try to find a position which contains data.";
    // If the tracing contains a volume tracing, the backend can only
    // search in the fallback layer of the segmentation layer for data.
    let layerNameToSearchDataIn = layerName;
    if (!isColorLayer) {
      const { volume } = Store.getState().tracing;
      if (volume && volume.fallbackLayer) {
        layerNameToSearchDataIn = volume.fallbackLayer;
      } else if (volume && !volume.fallbackLayer && !isDisabled) {
        isDisabled = true;
        tooltipText =
          "You do not have a fallback layer for this segmentation layer. It is only possible to search in fallback layers";
      }
    }

    return (
      <Tooltip title={tooltipText}>
        <AsyncIconButton
          type="scan"
          onClick={
            !isDisabled
              ? () => this.handleFindData(layerNameToSearchDataIn)
              : () => Promise.resolve()
          }
          style={{
            float: "right",
            marginTop: 4,
            cursor: !isDisabled ? "pointer" : "not-allowed",
          }}
        />
      </Tooltip>
    );
  };

  setVisibilityForAllLayers = (isVisible: boolean) => {
    const { layers } = this.props.datasetConfiguration;
    Object.keys(layers).forEach(otherLayerName =>
      this.props.onChangeLayer(otherLayerName, "isDisabled", !isVisible),
    );
    this.props.onChange("isSegmentationDisabled", !isVisible);
  };

  isLayerExclusivelyVisible = (layerName: string): boolean => {
    const { layers } = this.props.datasetConfiguration;
    const isOnlyGivenLayerVisible = Object.keys(layers).every(otherLayerName => {
      const { isDisabled } = layers[otherLayerName];
      return layerName === otherLayerName ? !isDisabled : isDisabled;
    });
    const { isSegmentationDisabled } = this.props.datasetConfiguration;
    const segmentation = Model.getSegmentationLayer();
    const segmentationLayerName = segmentation != null ? segmentation.name : null;
    if (layerName === segmentationLayerName) {
      return isOnlyGivenLayerVisible && !isSegmentationDisabled;
    } else {
      return isOnlyGivenLayerVisible && isSegmentationDisabled;
    }
  };

  getEnableDisableLayerSwitch = (
    isDisabled: boolean,
    onChange: (boolean, SyntheticMouseEvent<>) => void,
  ) => (
    <Tooltip title={isDisabled ? "Enable" : "Disable"} placement="top">
      {/* This div is necessary for the tooltip to be displayed */}
      <div style={{ display: "inline-block", marginRight: 8 }}>
        <Switch size="small" onChange={onChange} checked={!isDisabled} />
      </div>
    </Tooltip>
  );

  getHistogram = (layerName: string, layer: DatasetLayerConfiguration) => {
    const { intensityRange } = layer;
    let histograms = [
      { numberOfElements: 256, elementCounts: new Array(256).fill(0), min: 0, max: 255 },
    ];
    if (this.state.histograms && this.state.histograms[layerName]) {
      histograms = this.state.histograms[layerName];
    }
    return (
      <Histogram
        data={histograms}
        min={intensityRange[0]}
        max={intensityRange[1]}
        layerName={layerName}
      />
    );
  };

  getLayerSettingsHeader = (
    isDisabled: boolean,
    isColorLayer: boolean,
    layerName: string,
    elementClass: string,
  ) => {
    const setSingleLayerVisibility = (isVisible: boolean) => {
      if (isColorLayer) {
        this.props.onChangeLayer(layerName, "isDisabled", !isVisible);
      } else {
        this.props.onChange("isSegmentationDisabled", !isVisible);
      }
    };
    const onChange = (value, event) => {
      if (!event.ctrlKey) {
        setSingleLayerVisibility(value);
        return;
      }
      // If ctrl is pressed, toggle between "all layers visible" and
      // "only selected layer visible".
      if (this.isLayerExclusivelyVisible(layerName)) {
        this.setVisibilityForAllLayers(true);
      } else {
        this.setVisibilityForAllLayers(false);
        setSingleLayerVisibility(true);
      }
    };

    return (
      <Row style={{ marginTop: isDisabled ? 0 : 16 }}>
        <Col span={24}>
          {this.getEnableDisableLayerSwitch(isDisabled, onChange)}
          <span style={{ fontWeight: 700 }}>{layerName}</span>
          <Tag style={{ cursor: "default", marginLeft: 8 }}>{elementClass} Layer</Tag>
          {this.getFindDataButton(layerName, isDisabled, isColorLayer)}
        </Col>
      </Row>
    );
  };

  getLayerSettings = (
    layerName: string,
    layer: ?DatasetLayerConfiguration,
    isColorLayer: boolean = true,
  ) => {
    // Ensure that a color layer needs a layer.
    if (isColorLayer && !layer) {
      return null;
    }
    const elementClass = getElementClass(this.props.dataset, layerName);
    const isDisabled =
      isColorLayer && layer != null
        ? layer.isDisabled
        : this.props.datasetConfiguration.isSegmentationDisabled;

    return (
      <div key={layerName}>
        {this.getLayerSettingsHeader(isDisabled, isColorLayer, layerName, elementClass)}
        {isDisabled ? null : (
          <React.Fragment>
            {isHistogramSupported(elementClass) && layerName != null && layer != null
              ? this.getHistogram(layerName, layer)
              : null}
            <NumberSliderSetting
              label="Opacity"
              min={0}
              max={100}
              value={
                isColorLayer && layer != null
                  ? layer.alpha
                  : this.props.datasetConfiguration.segmentationOpacity
              }
              onChange={
                isColorLayer
                  ? _.partial(this.props.onChangeLayer, layerName, "alpha")
                  : _.partial(this.props.onChange, "segmentationOpacity")
              }
            />
            {isColorLayer && layer != null ? (
              <Row className="margin-bottom" align="top">
                <Col span={9}>
                  <label className="setting-label">{settings.invertColor}</label>
                </Col>
                <Col span={4}>
                  <Switch
                    size="small"
                    checked={layer.isInverted}
                    onChange={_.partial(this.props.onChangeLayer, layerName, "isInverted")}
                  />
                </Col>
                <Col span={9}>
                  <label className="setting-label">Color</label>
                </Col>
                <Col span={2}>
                  <ColorSetting
                    value={Utils.rgbToHex(layer.color)}
                    onChange={_.partial(this.props.onChangeLayer, layerName, "color")}
                    className="ant-btn"
                  />
                </Col>
              </Row>
            ) : (
              <SwitchSetting
                label={settings.highlightHoveredCellId}
                value={this.props.datasetConfiguration.highlightHoveredCellId}
                onChange={_.partial(this.props.onChange, "highlightHoveredCellId")}
              />
            )}
            {!isColorLayer &&
            (this.props.controlMode === ControlModeEnum.VIEW || window.allowIsosurfaces) ? (
              <SwitchSetting
                label="Render Isosurfaces (Beta)"
                value={this.props.datasetConfiguration.renderIsosurfaces}
                onChange={_.partial(this.props.onChange, "renderIsosurfaces")}
              />
            ) : null}
          </React.Fragment>
        )}
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
      const { upperBoundary, lowerBoundary } = getLayerBoundaries(dataset, layerName);
      const centerPosition = V3.add(lowerBoundary, upperBoundary).map(el => el / 2);

      Toast.warning(
        `Couldn't find data within layer "${layerName}." Jumping to the center of the layer's bounding box.`,
      );
      this.props.onSetPosition(centerPosition);
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
    if (!segmentationLayerName) {
      return null;
    }
    return this.getLayerSettings(segmentationLayerName, null, false);
  }

  renderPanelHeader = (hasInvisibleLayers: boolean) =>
    hasInvisibleLayers ? (
      <span>
        Layers
        <Tooltip title="Not all layers are currently visible.">
          <Icon type="exclamation-circle-o" style={{ marginLeft: 16, color: "coral" }} />
        </Tooltip>
      </span>
    ) : (
      "Layers"
    );

  render() {
    const { layers } = this.props.datasetConfiguration;
    const colorSettings = Object.entries(layers).map(entry => {
      const [layerName, layer] = entry;
      // $FlowFixMe Object.entries returns mixed for Flow
      return this.getLayerSettings(layerName, layer, true);
    });
    const hasInvisibleLayers =
      Object.keys(layers).find(
        layerName => layers[layerName].isDisabled || layers[layerName].alpha === 0,
      ) != null || this.props.datasetConfiguration.isSegmentationDisabled;
    return (
      <Collapse bordered={false} defaultActiveKey={["1", "2", "3", "4"]}>
        <Panel header={this.renderPanelHeader(hasInvisibleLayers)} key="1">
          {colorSettings}
          {this.props.hasSegmentation ? this.getSegmentationPanel() : null}
        </Panel>
        <Panel header="Data Rendering" key="3">
          <DropdownSetting
            label={
              <React.Fragment>
                {settings.gpuMemoryFactor}{" "}
                <Tooltip title="Adapt this setting to your hardware, so that rendering quality and performance are balanced. Medium is the default. Choosing a higher setting can result in poor performance.">
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
