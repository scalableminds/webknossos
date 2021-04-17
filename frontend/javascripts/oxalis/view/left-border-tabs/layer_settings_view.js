/**
 * tracing_settings_view.js
 * @flow
 */

import { Col, Collapse, Row, Switch, Tooltip, Modal } from "antd";
import {
  EditOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  ScanOutlined,
} from "@ant-design/icons";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import React, { useState } from "react";
import _ from "lodash";

import type { APIDataset } from "types/api_flow_types";
import { AsyncButton, AsyncIconButton } from "components/async_clickables";
import {
  SwitchSetting,
  NumberSliderSetting,
  ColorSetting,
} from "oxalis/view/settings/setting_input_views";
import { V3 } from "libs/mjs";
import {
  findDataPositionForLayer,
  clearCache,
  findDataPositionForVolumeTracing,
} from "admin/admin_rest_api";
import {
  getDefaultIntensityRangeOfLayer,
  getElementClass,
  getLayerBoundaries,
  getLayerByName,
  getResolutionInfo,
  getResolutions,
} from "oxalis/model/accessors/dataset_accessor";
import { getMaxZoomValueForResolution } from "oxalis/model/accessors/flycam_accessor";
import { setPositionAction, setZoomStepAction } from "oxalis/model/actions/flycam_actions";
import {
  updateDatasetSettingAction,
  updateLayerSettingAction,
} from "oxalis/model/actions/settings_actions";
import Model from "oxalis/model";
import Store, {
  type DatasetConfiguration,
  type DatasetLayerConfiguration,
  type OxalisState,
  type HistogramDataForAllLayers,
  type Tracing,
  type Task,
} from "oxalis/store";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import api from "oxalis/api/internal_api";
import { type Vector3 } from "oxalis/constants";
import { settings } from "messages";

import MappingSettingsView from "./mapping_settings_view";
import Histogram, { isHistogramSupported } from "./histogram_view";

const { Panel } = Collapse;

type LayerSettingsViewProps = {|
  datasetConfiguration: DatasetConfiguration,
  dataset: APIDataset,
  onChange: (propertyName: $Keys<DatasetConfiguration>, value: any) => void,
  onChangeLayer: (
    layerName: string,
    propertyName: $Keys<DatasetLayerConfiguration>,
    value: any,
  ) => void,
  histogramData: HistogramDataForAllLayers,
  onSetPosition: Vector3 => void,
  onZoomToResolution: Vector3 => number,
  tracing: Tracing,
  task: ?Task,
|};

function DownsampleVolumeModal({ visible, hideDownsampleVolumeModal, magsToDownsample }) {
  const [isDownsampling, setIsDownsampling] = useState(false);

  const handleTriggerDownsampling = async () => {
    setIsDownsampling(true);
    await api.tracing.downsampleSegmentation();
    setIsDownsampling(false);
  };

  return (
    <Modal
      title="Downsample Volume Annotation"
      onCancel={isDownsampling ? null : hideDownsampleVolumeModal}
      visible={visible}
      footer={null}
      width={800}
      maskClosable={false}
    >
      <p>
        This annotation does not have volume annotation data in all resolutions. Consequently,
        annotation data cannot be rendered at all zoom values. By clicking &quot;Downsample&quot;,
        webKnossos will use the best resolution of the volume data to create all dependent
        resolutions.
      </p>

      <p>
        The following resolutions will be added when clicking &quot;Downsample&quot;:{" "}
        {magsToDownsample.map(mag => mag.join("-")).join(", ")}.
      </p>

      <div>
        The cause for the missing resolutions can be one of the following:
        <ul>
          <li>
            The annotation was created before webKnossos supported multi-resolution volume tracings.
          </li>
          <li>An old annotation was uploaded which did not include all resolutions.</li>
          <li>The annotation was created in a task that was restricted to certain resolutions.</li>
          <li>The dataset was mutated to have more resolutions.</li>
        </ul>
      </div>

      <p style={{ fontWeight: "bold" }}>
        Note that this action might take a few minutes. Afterwards, the annotation is reloaded.
        Also, the version history of the volume data will be reset.
      </p>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
        <AsyncButton onClick={handleTriggerDownsampling} type="primary">
          Downsample
        </AsyncButton>
      </div>
    </Modal>
  );
}

type State = {|
  isDownsampleVolumeModalVisible: boolean,
|};

class LayerSettingsView extends React.PureComponent<LayerSettingsViewProps, State> {
  state = {
    isDownsampleVolumeModalVisible: false,
  };

  getFindDataButton = (layerName: string, isDisabled: boolean, isColorLayer: boolean) => {
    let tooltipText = isDisabled
      ? "You cannot search for data when the layer is disabled."
      : "If you are having trouble finding your data, webKnossos can try to find a position which contains data.";

    const { volume } = Store.getState().tracing;
    if (!isColorLayer && volume && volume.fallbackLayer) {
      tooltipText =
        "webKnossos will try to find data in your volume tracing first and in the fallback layer afterwards.";
    }

    return (
      <Tooltip title={tooltipText}>
        <AsyncIconButton
          icon={<ScanOutlined />}
          onClick={
            !isDisabled
              ? () => this.handleFindData(layerName, isColorLayer)
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
          icon={<ReloadOutlined />}
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

  getEditMinMaxButton = (layerName: string, isInEditMode: boolean) => {
    const tooltipText = isInEditMode
      ? "Stop editing the possible range of the histogram."
      : "Manually set the possible range of the histogram.";
    return (
      <Tooltip title={tooltipText}>
        <EditOutlined
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
    const setSingleLayerVisibility = (isVisible: boolean) => {
      this.props.onChangeLayer(layerName, "isDisabled", !isVisible);
    };
    const onChange = (value, event) => {
      if (!event.ctrlKey && !event.altKey && !event.shiftKey) {
        setSingleLayerVisibility(value);
        return;
      }
      // If a modifier is pressed, toggle between "all layers visible" and
      // "only selected layer visible".
      if (this.isLayerExclusivelyVisible(layerName)) {
        this.setVisibilityForAllLayers(true);
      } else {
        this.setVisibilityForAllLayers(false);
        setSingleLayerVisibility(true);
      }
    };
    const hasHistogram = this.props.histogramData[layerName] != null;

    const layer = getLayerByName(this.props.dataset, layerName);
    const resolutions = getResolutionInfo(layer.resolutions).getResolutionList();

    return (
      <Row>
        <Col span={24}>
          {this.getEnableDisableLayerSwitch(isDisabled, onChange)}
          <span style={{ fontWeight: 700, wordWrap: "break-word" }}>
            {!isColorLayer && isVolumeTracing ? "Volume Annotation" : layerName}
          </span>

          <Tooltip
            title={
              <div>
                Data Type: {elementClass}
                <br />
                Available resolutions:
                <ul>
                  {resolutions.map(r => (
                    <li key={r.join()}>{r.join("-")}</li>
                  ))}
                </ul>
              </div>
            }
            placement="left"
          >
            <InfoCircleOutlined style={{ marginLeft: 4 }} />
          </Tooltip>

          {isColorLayer ? null : this.getOptionalDownsampleVolumeIcon()}

          {hasHistogram ? this.getEditMinMaxButton(layerName, isInEditMode) : null}
          {this.getFindDataButton(layerName, isDisabled, isColorLayer)}
          {this.getReloadDataButton(layerName)}
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
            {isColorLayer && (
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
            )}
          </div>
        )}
      </div>
    );
  };

  handleFindData = async (layerName: string, isDataLayer: boolean) => {
    const { volume, tracingStore } = Store.getState().tracing;
    const { dataset } = this.props;
    let foundPosition;
    let foundResolution;

    if (volume && !isDataLayer) {
      const { position, resolution } = await findDataPositionForVolumeTracing(
        tracingStore.url,
        volume.tracingId,
      );
      if ((!position || !resolution) && volume.fallbackLayer) {
        await this.handleFindData(volume.fallbackLayer, true);
        return;
      }
      foundPosition = position;
      foundResolution = resolution;
    } else {
      const { position, resolution } = await findDataPositionForLayer(
        dataset.dataStore.url,
        dataset,
        layerName,
      );
      foundPosition = position;
      foundResolution = resolution;
    }

    if (!foundPosition || !foundResolution) {
      const { upperBoundary, lowerBoundary } = getLayerBoundaries(dataset, layerName);
      const centerPosition = V3.add(lowerBoundary, upperBoundary).map(el => el / 2);

      Toast.warning(
        `Couldn't find data within layer "${layerName}." Jumping to the center of the layer's bounding box.`,
      );
      this.props.onSetPosition(centerPosition);
      return;
    }

    this.props.onSetPosition(foundPosition);
    const zoomValue = this.props.onZoomToResolution(foundResolution);
    Toast.success(
      `Jumping to position ${foundPosition.join(", ")} and zooming to ${zoomValue.toFixed(2)}`,
    );
  };

  reloadLayerData = async (layerName: string): Promise<void> => {
    await clearCache(this.props.dataset, layerName);
    await api.data.reloadBuckets(layerName);
    window.needsRerender = true;
    Toast.success(`Successfully reloaded data of layer ${layerName}.`);
  };

  renderPanelHeader = (hasInvisibleLayers: boolean) =>
    hasInvisibleLayers ? (
      <span>
        Layers
        <Tooltip title="Not all layers are currently visible.">
          <ExclamationCircleOutlined style={{ marginLeft: 16, color: "coral" }} />
        </Tooltip>
      </span>
    ) : (
      "Layers"
    );

  getVolumeMagsToDownsample = (): Array<Vector3> => {
    if (this.props.task != null) {
      return [];
    }
    const volumeTracing = this.props.tracing.volume;
    if (volumeTracing == null) {
      return [];
    }
    const segmentationLayer = Model.getSegmentationLayer();
    const { fallbackLayerInfo } = segmentationLayer;
    const volumeTargetResolutions =
      fallbackLayerInfo != null
        ? fallbackLayerInfo.resolutions
        : getResolutions(this.props.dataset);

    const getMaxDim = resolution => Math.max(...resolution);

    const volumeTracingResolutions = segmentationLayer.resolutions;

    const sourceMag = _.minBy(volumeTracingResolutions, getMaxDim);
    const possibleMags = volumeTargetResolutions.filter(
      resolution => getMaxDim(resolution) >= getMaxDim(sourceMag),
    );

    const magsToDownsample = _.differenceWith(possibleMags, volumeTracingResolutions, _.isEqual);
    return magsToDownsample;
  };

  getOptionalDownsampleVolumeIcon = () => {
    const magsToDownsample = this.getVolumeMagsToDownsample();
    const hasExtensiveResolutions = magsToDownsample.length === 0;

    if (hasExtensiveResolutions) {
      return null;
    }

    return (
      <Tooltip title="Open Dialog to Downsample Volume Data">
        <a href="#" onClick={this.showDownsampleVolumeModal}>
          <img
            src="/assets/images/icon-downsampling.svg"
            style={{
              width: 20,
              height: 20,
              filter:
                "invert(47%) sepia(52%) saturate(1836%) hue-rotate(352deg) brightness(99%) contrast(105%)",
              verticalAlign: "top",
              cursor: "pointer",
            }}
            alt="Resolution Icon"
          />
        </a>
      </Tooltip>
    );
  };

  showDownsampleVolumeModal = () => {
    this.setState({ isDownsampleVolumeModalVisible: true });
  };

  hideDownsampleVolumeModal = () => {
    this.setState({ isDownsampleVolumeModalVisible: false });
  };

  render() {
    const { layers } = this.props.datasetConfiguration;
    const segmentationLayerName = Model.getSegmentationLayerName();
    const layerSettings = Object.entries(layers).map(entry => {
      const [layerName, layer] = entry;
      const isColorLayer = segmentationLayerName !== layerName;
      // $FlowIssue[incompatible-call] Object.entries returns mixed for Flow
      return this.getLayerSettings(layerName, layer, isColorLayer);
    });
    const hasInvisibleLayers =
      Object.keys(layers).find(
        layerName => layers[layerName].isDisabled || layers[layerName].alpha === 0,
      ) != null;
    return (
      <React.Fragment>
        <Collapse bordered={false} defaultActiveKey={["1", "2"]} className="tracing-settings-menu">
          <Panel header={this.renderPanelHeader(hasInvisibleLayers)} key="1">
            {layerSettings}
          </Panel>
          <Panel header="Mapping Settings" key="2">
            <MappingSettingsView />
          </Panel>
        </Collapse>
        <DownsampleVolumeModal
          visible={this.state.isDownsampleVolumeModalVisible}
          hideDownsampleVolumeModal={this.hideDownsampleVolumeModal}
          magsToDownsample={this.getVolumeMagsToDownsample()}
        />
      </React.Fragment>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  datasetConfiguration: state.datasetConfiguration,
  histogramData: state.temporaryConfiguration.histogramData,
  dataset: state.dataset,
  tracing: state.tracing,
  task: state.task,
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

export default connect<LayerSettingsViewProps, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(LayerSettingsView);
