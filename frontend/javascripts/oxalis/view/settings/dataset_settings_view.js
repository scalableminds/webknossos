/**
 * tracing_settings_view.js
 * @flow
 */

import { Col, Collapse, Icon, Row, Select, Switch, Tag, Tooltip, Modal } from "antd";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import * as React from "react";
import _ from "lodash";
import { V3 } from "libs/mjs";
import api from "oxalis/api/internal_api";

import messages, { settings } from "messages";
import type { APIDataset } from "admin/api_flow_types";
import { AsyncIconButton } from "components/async_clickables";
import {
  SwitchSetting,
  NumberSliderSetting,
  DropdownSetting,
  ColorSetting,
} from "oxalis/view/settings/setting_input_views";
import { findDataPositionForLayer, clearCache } from "admin/admin_rest_api";
import { getGpuFactorsWithLabels } from "oxalis/model/bucket_data_handling/data_rendering_logic";
import { getMaxZoomValueForResolution } from "oxalis/model/accessors/flycam_accessor";
import {
  getElementClass,
  getLayerBoundaries,
  getDefaultIntensityRangeOfLayer,
} from "oxalis/model/accessors/dataset_accessor";
import { setPositionAction, setZoomStepAction } from "oxalis/model/actions/flycam_actions";
import {
  updateDatasetSettingAction,
  updateLayerSettingAction,
  updateUserSettingAction,
} from "oxalis/model/actions/settings_actions";
import { removeFallbackLayerAction } from "oxalis/model/actions/volumetracing_actions";
import Model from "oxalis/model";
import Store, {
  type DatasetConfiguration,
  type DatasetLayerConfiguration,
  type OxalisState,
  type UserConfiguration,
  type HistogramDataForAllLayers,
  type Tracing,
} from "oxalis/store";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import constants, { type ViewMode, type Vector3 } from "oxalis/constants";

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
  histogramData: HistogramDataForAllLayers,
  onSetPosition: Vector3 => void,
  onZoomToResolution: Vector3 => number,
  onChangeUser: (key: $Keys<UserConfiguration>, value: any) => void,
  onRemoveFallbackLayer: () => void,
  tracing: Tracing,
|};

class DatasetSettings extends React.PureComponent<DatasetSettingsProps> {
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
          "You do not have a fallback layer for this segmentation layer. It is only possible to search in fallback layers.";
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
            position: "absolute",
            top: 4,
            right: -16,
            cursor: !isDisabled ? "pointer" : "not-allowed",
          }}
        />
      </Tooltip>
    );
  };

  getReloadDataButton = (layerName: string) => {
    const tooltipText =
      "Reload the data from the server. Use this when the data on the server changed.";
    return (
      <Tooltip title={tooltipText}>
        <AsyncIconButton
          type="reload"
          onClick={() => this.reloadLayerData(layerName)}
          style={{
            position: "absolute",
            top: 4,
            right: 6,
            cursor: "pointer",
          }}
        />
      </Tooltip>
    );
  };

  getDeleteButton = (layerName: string) => (
    <Tooltip title="Unlink dataset's original segmentation layer">
      <Icon
        type="stop"
        onClick={() => {
          this.removeFallbackLayer(layerName);
        }}
        style={{
          position: "absolute",
          top: 4,
          right: 26,
          cursor: "pointer",
        }}
      />
    </Tooltip>
  );

  removeFallbackLayer = (layerName: string) => {
    Modal.confirm({
      title: messages["tracing.confirm_remove_fallback_layer.title"],
      content: (
        <div>
          <p>{messages["tracing.confirm_remove_fallback_layer.explanation"]}</p>
          <p>{messages["tracing.confirm_remove_fallback_layer.notes"]}</p>
        </div>
      ),
      onOk: async () => {
        this.props.onRemoveFallbackLayer();
        this.reloadLayerData(layerName);
      },
      width: 600,
    });
  };

  getEditMinMaxButton = (layerName: string, isInEditMode: boolean) => {
    const tooltipText = isInEditMode
      ? "Stop editing the possible range of the histogram."
      : "Manually set the possible range of the histogram.";
    return (
      <Tooltip title={tooltipText}>
        <Icon
          type="edit"
          onClick={() => this.props.onChangeLayer(layerName, "isInEditMode", !isInEditMode)}
          style={{
            position: "absolute",
            top: 4,
            right: 30,
            cursor: "pointer",
            color: isInEditMode ? "rgb(24, 144, 255)" : null,
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
  };

  isLayerExclusivelyVisible = (layerName: string): boolean => {
    const { layers } = this.props.datasetConfiguration;
    const isOnlyGivenLayerVisible = Object.keys(layers).every(otherLayerName => {
      const { isDisabled } = layers[otherLayerName];
      return layerName === otherLayerName ? !isDisabled : isDisabled;
    });
    return isOnlyGivenLayerVisible;
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
    const { intensityRange, min, max, isInEditMode } = layer;
    const defaultIntensityRange = getDefaultIntensityRangeOfLayer(this.props.dataset, layerName);
    let histograms = [];
    if (this.props.histogramData && this.props.histogramData[layerName]) {
      histograms = this.props.histogramData[layerName];
    } else {
      histograms = [
        {
          numberOfElements: 0,
          elementCounts: [],
          min: defaultIntensityRange[0],
          max: defaultIntensityRange[1],
        },
      ];
    }
    return (
      <Histogram
        data={histograms}
        intensityRangeMin={intensityRange[0]}
        intensityRangeMax={intensityRange[1]}
        min={min}
        max={max}
        isInEditMode={isInEditMode}
        layerName={layerName}
        defaultMinMax={defaultIntensityRange}
      />
    );
  };

  getLayerSettingsHeader = (
    isDisabled: boolean,
    isColorLayer: boolean,
    isInEditMode: boolean,
    layerName: string,
    elementClass: string,
  ) => {
    const { tracing } = this.props;
    const isVolumeTracing = tracing.volume != null;
    const isFallbackLayer = tracing.volume
      ? tracing.volume.fallbackLayer != null && !isColorLayer
      : false;
    const setSingleLayerVisibility = (isVisible: boolean) => {
      this.props.onChangeLayer(layerName, "isDisabled", !isVisible);
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
    const hasHistogram = this.props.histogramData[layerName] != null;

    return (
      <Row>
        <Col span={24}>
          {this.getEnableDisableLayerSwitch(isDisabled, onChange)}
          <span style={{ fontWeight: 700 }}>
            {!isColorLayer && isVolumeTracing ? "Volume Layer" : layerName}
          </span>
          <Tag style={{ cursor: "default", marginLeft: 8 }}>{elementClass}</Tag>
          {hasHistogram ? this.getEditMinMaxButton(layerName, isInEditMode) : null}
          {this.getFindDataButton(layerName, isDisabled, isColorLayer)}
          {this.getReloadDataButton(layerName)}
          {isFallbackLayer ? this.getDeleteButton(layerName) : null}
        </Col>
      </Row>
    );
  };

  getLayerSettings = (
    layerName: string,
    layerConfiguration: ?DatasetLayerConfiguration,
    isColorLayer: boolean = true,
  ) => {
    // Ensure that every layer needs a layer configuration and that color layers have a color layer.
    if (!layerConfiguration || (isColorLayer && !layerConfiguration.color)) {
      return null;
    }
    const elementClass = getElementClass(this.props.dataset, layerName);
    const { isDisabled, isInEditMode } = layerConfiguration;
    return (
      <div key={layerName}>
        {this.getLayerSettingsHeader(
          isDisabled,
          isColorLayer,
          isInEditMode,
          layerName,
          elementClass,
        )}
        {isDisabled ? null : (
          <div style={{ marginBottom: 30, marginLeft: 10 }}>
            {isHistogramSupported(elementClass) && layerName != null && isColorLayer
              ? this.getHistogram(layerName, layerConfiguration)
              : null}
            <NumberSliderSetting
              label="Opacity"
              min={0}
              max={100}
              value={layerConfiguration.alpha}
              onChange={_.partial(this.props.onChangeLayer, layerName, "alpha")}
            />
            {!isColorLayer && (
              <NumberSliderSetting
                label={settings.segmentationPatternOpacity}
                min={0}
                max={100}
                step={1}
                value={this.props.datasetConfiguration.segmentationPatternOpacity}
                onChange={_.partial(this.props.onChange, "segmentationPatternOpacity")}
              />
            )}
            {isColorLayer ? (
              <Row className="margin-bottom" style={{ marginTop: 6 }}>
                <Col span={12}>
                  <label className="setting-label">Color</label>
                </Col>
                <Col span={10}>
                  <ColorSetting
                    value={Utils.rgbToHex(layerConfiguration.color)}
                    onChange={_.partial(this.props.onChangeLayer, layerName, "color")}
                    className="ant-btn"
                    style={{ marginLeft: 6 }}
                  />
                </Col>
                <Col span={2}>
                  <Tooltip title="Invert the color of this layer.">
                    <div
                      onClick={() =>
                        this.props.onChangeLayer(
                          layerName,
                          "isInverted",
                          layerConfiguration ? !layerConfiguration.isInverted : false,
                        )
                      }
                      style={{
                        position: "absolute",
                        top: 0,
                        right: -9,
                        marginTop: 0,
                        display: "inline-flex",
                      }}
                    >
                      <i
                        className={`fas fa-adjust ${
                          layerConfiguration.isInverted ? "flip-horizontally" : ""
                        }`}
                        style={{
                          margin: 0,
                          transition: "transform 0.5s ease 0s",
                          color: layerConfiguration.isInverted
                            ? "rgba(24, 144, 255, 1.0)"
                            : "rgba(0, 0, 0, 0.65)",
                        }}
                      />
                    </div>
                  </Tooltip>
                </Col>
              </Row>
            ) : (
              <SwitchSetting
                label={settings.highlightHoveredCellId}
                value={this.props.datasetConfiguration.highlightHoveredCellId}
                onChange={_.partial(this.props.onChange, "highlightHoveredCellId")}
              />
            )}
            {!isColorLayer ? (
              <SwitchSetting
                label="Render Isosurfaces (Beta)"
                value={this.props.datasetConfiguration.renderIsosurfaces}
                onChange={_.partial(this.props.onChange, "renderIsosurfaces")}
              />
            ) : null}
          </div>
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

  reloadLayerData = async (layerName: string): Promise<void> => {
    await clearCache(this.props.dataset, layerName);
    api.data.reloadBuckets(layerName);
    window.needsRerender = true;
    Toast.success(`Successfully reloaded data of layer ${layerName}.`);
  };

  onChangeRenderMissingDataBlack = async (value: boolean): Promise<void> => {
    Toast.info(
      value
        ? messages["data.enabled_render_missing_data_black"]
        : messages["data.disabled_render_missing_data_black"],
      { timeout: 8000 },
    );
    this.props.onChange("renderMissingDataBlack", value);
    const { layers } = this.props.datasetConfiguration;
    const reloadAllLayersPromises = Object.keys(layers).map(async layerName => {
      await clearCache(this.props.dataset, layerName);
      api.data.reloadBuckets(layerName);
    });
    await Promise.all(reloadAllLayersPromises);
    window.needsRerender = true;
    Toast.success("Successfully reloaded data of all layers.");
  };

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
    const segmentationLayerName = Model.getSegmentationLayerName();
    const layerSettings = Object.entries(layers).map(entry => {
      const [layerName, layer] = entry;
      const isColorLayer = segmentationLayerName !== layerName;
      // $FlowFixMe Object.entries returns mixed for Flow
      return this.getLayerSettings(layerName, layer, isColorLayer);
    });
    const hasInvisibleLayers =
      Object.keys(layers).find(
        layerName => layers[layerName].isDisabled || layers[layerName].alpha === 0,
      ) != null;
    return (
      <Collapse bordered={false} defaultActiveKey={["1", "2", "3", "4"]}>
        <Panel header={this.renderPanelHeader(hasInvisibleLayers)} key="1">
          {layerSettings}
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
  histogramData: state.temporaryConfiguration.histogramData,
  dataset: state.dataset,
  tracing: state.tracing,
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
  onRemoveFallbackLayer() {
    dispatch(removeFallbackLayerAction());
  },
});

export default connect<DatasetSettingsProps, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(DatasetSettings);
