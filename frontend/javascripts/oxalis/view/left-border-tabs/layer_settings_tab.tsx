import { Button, Col, Divider, Row, Switch, Tooltip } from "antd";
import type { Dispatch } from "redux";
import {
  EditOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  ScanOutlined,
  WarningOutlined,
  PlusOutlined,
  VerticalAlignMiddleOutlined,
  LockOutlined,
  UnlockOutlined,
} from "@ant-design/icons";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";

import classnames from "classnames";
import {
  APIAnnotationTypeEnum,
  APIDataLayer,
  APIDataset,
  EditableLayerProperties,
} from "types/api_flow_types";
import { ValueOf } from "types/globals";
import { AsyncIconButton } from "components/async_clickables";
import { HoverIconButton } from "components/hover_icon_button";
import {
  SwitchSetting,
  NumberSliderSetting,
  LogSliderSetting,
  ColorSetting,
} from "oxalis/view/components/setting_input_views";
import { V3 } from "libs/mjs";
import { editAnnotationLayerAction } from "oxalis/model/actions/annotation_actions";
import {
  enforceSkeletonTracing,
  getActiveNode,
} from "oxalis/model/accessors/skeletontracing_accessor";
import {
  findDataPositionForLayer,
  clearCache,
  findDataPositionForVolumeTracing,
  convertToHybridTracing,
} from "admin/admin_rest_api";
import {
  getDefaultIntensityRangeOfLayer,
  getElementClass,
  isColorLayer as getIsColorLayer,
  getLayerBoundaries,
  getLayerByName,
  getResolutionInfo,
  getResolutions,
} from "oxalis/model/accessors/dataset_accessor";
import { getMaxZoomValueForResolution } from "oxalis/model/accessors/flycam_accessor";
import {
  getAllReadableLayerNames,
  getReadableNameByVolumeTracingId,
  getVolumeDescriptorById,
  getVolumeTracingById,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  setNodeRadiusAction,
  setShowSkeletonsAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { setPositionAction, setZoomStepAction } from "oxalis/model/actions/flycam_actions";
import {
  updateUserSettingAction,
  updateDatasetSettingAction,
  updateLayerSettingAction,
  dispatchClipHistogramAsync,
} from "oxalis/model/actions/settings_actions";
import { userSettings } from "types/schemas/user_settings.schema";
import type { Vector3, ControlMode } from "oxalis/constants";
import Constants, { ControlModeEnum } from "oxalis/constants";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import LinkButton from "components/link_button";
import Model from "oxalis/model";
import type {
  VolumeTracing,
  DatasetConfiguration,
  DatasetLayerConfiguration,
  OxalisState,
  UserConfiguration,
  HistogramDataForAllLayers,
  Tracing,
  Task,
} from "oxalis/store";
import Store from "oxalis/store";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import api from "oxalis/api/internal_api";
import { settings } from "messages";
import { MaterializeVolumeAnnotationModal } from "oxalis/view/right-border-tabs/starting_job_modals";
import AddVolumeLayerModal, { validateReadableLayerName } from "./modals/add_volume_layer_modal";
import DownsampleVolumeModal from "./modals/downsample_volume_modal";
import Histogram, { isHistogramSupported } from "./histogram_view";
import MappingSettingsView from "./mapping_settings_view";

type DatasetSettingsProps = {
  userConfiguration: UserConfiguration;
  datasetConfiguration: DatasetConfiguration;
  dataset: APIDataset;
  onChange: (propertyName: keyof DatasetConfiguration, value: any) => void;
  onChangeLayer: (
    layerName: string,
    propertyName: keyof DatasetLayerConfiguration,
    value: any,
  ) => void;
  onClipHistogram: (layerName: string, shouldAdjustClipRange: boolean) => Promise<void>;
  histogramData: HistogramDataForAllLayers;
  onChangeRadius: (value: number) => void;
  onChangeShowSkeletons: (arg0: boolean) => void;
  onSetPosition: (arg0: Vector3) => void;
  onZoomToResolution: (arg0: Vector3) => number;
  onChangeUser: (key: keyof UserConfiguration, value: any) => void;
  tracing: Tracing;
  task: Task | null | undefined;
  onEditAnnotationLayer: (tracingId: string, layerProperties: EditableLayerProperties) => void;
  controlMode: ControlMode;
  isArbitraryMode: boolean;
};

type State = {
  // If this is set to not-null, the downsampling modal
  // is shown for that VolumeTracing
  volumeTracingToDownsample: VolumeTracing | null | undefined;
  isAddVolumeLayerModalVisible: boolean;
  preselectedSegmentationLayerName: string | undefined;
  segmentationLayerWasPreselected: boolean | undefined;
  layerToMergeWithFallback: APIDataLayer | null | undefined;
};

class DatasetSettings extends React.PureComponent<DatasetSettingsProps, State> {
  onChangeUser: Record<keyof UserConfiguration, (...args: Array<any>) => any>;
  state: State = {
    volumeTracingToDownsample: null,
    isAddVolumeLayerModalVisible: false,
    preselectedSegmentationLayerName: undefined,
    segmentationLayerWasPreselected: false,
    layerToMergeWithFallback: null,
  };

  constructor(props: DatasetSettingsProps) {
    super(props);
    this.onChangeUser = _.mapValues(this.props.userConfiguration, (__, propertyName) =>
      _.partial(this.props.onChangeUser, propertyName as keyof UserConfiguration),
    );
  }

  getFindDataButton = (
    layerName: string,
    isDisabled: boolean,
    isColorLayer: boolean,
    maybeVolumeTracing: VolumeTracing | null | undefined,
  ) => {
    let tooltipText = isDisabled
      ? "You cannot search for data when the layer is disabled."
      : "If you are having trouble finding your data, webKnossos can try to find a position which contains data.";

    if (!isColorLayer && maybeVolumeTracing && maybeVolumeTracing.fallbackLayer) {
      tooltipText =
        "webKnossos will try to find data in your volume tracing first and in the fallback layer afterwards.";
    }

    return (
      <Tooltip title={tooltipText}>
        <AsyncIconButton
          icon={<ScanOutlined />}
          onClick={
            !isDisabled
              ? () => this.handleFindData(layerName, isColorLayer, maybeVolumeTracing)
              : () => Promise.resolve()
          }
          style={{
            cursor: !isDisabled ? "pointer" : "not-allowed",
          }}
        />
      </Tooltip>
    );
  };

  getReloadDataButton = (layerName: string) => {
    if (!this.props.dataset.isEditable) {
      return null;
    }
    const tooltipText =
      "Reload the data from the server. Use this when the data on the server changed.";
    return (
      <Tooltip title={tooltipText}>
        <AsyncIconButton
          icon={<ReloadOutlined />}
          onClick={() => this.reloadLayerData(layerName)}
          style={{
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
            cursor: "pointer",
            color: isInEditMode ? "var(--ant-primary)" : undefined,
          }}
        />
      </Tooltip>
    );
  };

  getMergeWithFallbackLayerButton = (layer: APIDataLayer) => (
    <Tooltip title="Merge this volume annotation with its fallback layer.">
      <i
        onClick={() => this.setState({ layerToMergeWithFallback: layer })}
        className="fas fa-object-ungroup"
        style={{
          cursor: "pointer",
          opacity: 0.7,
        }}
      />
    </Tooltip>
  );

  getClipButton = (layerName: string, isInEditMode: boolean) => {
    const editModeAddendum = isInEditMode
      ? "In Edit Mode, the histogram's range will be adjusted, too."
      : "";
    const tooltipText = `Automatically clip the histogram to enhance contrast. ${editModeAddendum}`;
    return (
      <Tooltip title={tooltipText}>
        <AsyncIconButton
          icon={<VerticalAlignMiddleOutlined />}
          style={{
            cursor: "pointer",
            transform: "rotate(90deg)",
          }}
          onClick={() => this.props.onClipHistogram(layerName, isInEditMode)}
        />
      </Tooltip>
    );
  };

  setVisibilityForAllLayers = (isVisible: boolean) => {
    const { layers } = this.props.datasetConfiguration;
    Object.keys(layers).forEach((otherLayerName) =>
      this.props.onChangeLayer(otherLayerName, "isDisabled", !isVisible),
    );
  };

  isLayerExclusivelyVisible = (layerName: string): boolean => {
    const { layers } = this.props.datasetConfiguration;
    const isOnlyGivenLayerVisible = Object.keys(layers).every((otherLayerName) => {
      const { isDisabled } = layers[otherLayerName];
      return layerName === otherLayerName ? !isDisabled : isDisabled;
    });
    return isOnlyGivenLayerVisible;
  };

  getEnableDisableLayerSwitch = (
    isDisabled: boolean,
    onChange: (arg0: boolean, arg1: MouseEvent) => void,
  ) => (
    <Tooltip title={isDisabled ? "Show" : "Hide"} placement="top">
      {/* This div is necessary for the tooltip to be displayed */}
      <div
        style={{
          display: "inline-block",
          marginRight: 8,
        }}
      >
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
    layerSettings: DatasetLayerConfiguration,
  ) => {
    const { tracing, dataset } = this.props;
    const { intensityRange } = layerSettings;
    const layer = getLayerByName(dataset, layerName);
    const isSegmentation = layer.category === "segmentation";
    const canBeMadeEditable =
      isSegmentation && layer.tracingId == null && this.props.controlMode === "TRACE";
    const isVolumeTracing = isSegmentation ? layer.tracingId != null : false;
    const maybeTracingId = isSegmentation ? layer.tracingId : null;
    const maybeVolumeTracing =
      maybeTracingId != null ? getVolumeTracingById(tracing, maybeTracingId) : null;
    const maybeFallbackLayer =
      maybeVolumeTracing != null && maybeVolumeTracing.fallbackLayer != null
        ? maybeVolumeTracing.fallbackLayer
        : null;

    const setSingleLayerVisibility = (isVisible: boolean) => {
      this.props.onChangeLayer(layerName, "isDisabled", !isVisible);
    };

    const onChange = (value: boolean, event: MouseEvent) => {
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
    const resolutions = getResolutionInfo(layer.resolutions).getResolutionList();
    const volumeDescriptor =
      "tracingId" in layer && layer.tracingId != null
        ? getVolumeDescriptorById(tracing, layer.tracingId)
        : null;
    const readableName =
      "tracingId" in layer && layer.tracingId != null
        ? getReadableNameByVolumeTracingId(tracing, layer.tracingId)
        : layerName;
    const allReadableLayerNames = getAllReadableLayerNames(dataset, tracing);
    const readableLayerNameValidationResult = validateReadableLayerName(
      readableName,
      allReadableLayerNames,
      readableName,
    );
    return (
      <div className="flex-container">
        {this.getEnableDisableLayerSwitch(isDisabled, onChange)}
        <div
          className="flex-item"
          style={{
            fontWeight: 700,
            paddingRight: 5,
          }}
        >
          {volumeDescriptor != null ? (
            <Tooltip
              title={
                readableLayerNameValidationResult.isValid
                  ? null
                  : readableLayerNameValidationResult.message
              }
            >
              <span style={{ display: "inline-block" }}>
                <EditableTextLabel
                  margin="0 10px 0 0"
                  width={150}
                  value={readableName}
                  isInvalid={!readableLayerNameValidationResult.isValid}
                  trimValue
                  onChange={(newName) => {
                    this.props.onEditAnnotationLayer(volumeDescriptor.tracingId, {
                      name: newName,
                    });
                  }}
                  rules={[
                    {
                      validator: (newReadableLayerName) =>
                        validateReadableLayerName(
                          newReadableLayerName,
                          allReadableLayerNames,
                          readableName,
                        ),
                    },
                  ]}
                  label="Volume Layer Name"
                />
              </span>
            </Tooltip>
          ) : (
            layerName
          )}
        </div>
        <div
          className="flex-container"
          style={{
            paddingRight: 1,
          }}
        >
          <div className="flex-item">
            <Tooltip
              overlayStyle={{
                maxWidth: 800,
              }}
              title={
                <div>
                  <div>Data Type: {elementClass}</div>
                  <div>
                    Available resolutions:
                    <ul>
                      {resolutions.map((r) => (
                        <li key={r.join()}>{r.join("-")}</li>
                      ))}
                    </ul>
                  </div>
                  Bounding Box:
                  <table style={{ borderSpacing: 2, borderCollapse: "separate" }}>
                    <tbody>
                      <tr>
                        <td />
                        <td style={{ fontSize: 10 }}>X</td>
                        <td style={{ fontSize: 10 }}>Y</td>
                        <td style={{ fontSize: 10 }}>Z</td>
                      </tr>
                      <tr>
                        <td style={{ fontSize: 10 }}>Min</td>
                        <td>{layer.boundingBox.topLeft[0]} </td>
                        <td>{layer.boundingBox.topLeft[1]} </td>
                        <td>{layer.boundingBox.topLeft[2]}</td>
                      </tr>
                      <tr>
                        <td style={{ fontSize: 10 }}>Max</td>
                        <td>{layer.boundingBox.topLeft[0] + layer.boundingBox.width}</td>
                        <td>{layer.boundingBox.topLeft[1] + layer.boundingBox.height} </td>
                        <td>{layer.boundingBox.topLeft[2] + layer.boundingBox.depth}</td>
                      </tr>
                      <tr>
                        <td style={{ fontSize: 10 }}>Size</td>
                        <td>{layer.boundingBox.width} </td>
                        <td>{layer.boundingBox.height} </td>
                        <td>{layer.boundingBox.depth}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              }
              placement="left"
            >
              <InfoCircleOutlined />
            </Tooltip>
            {canBeMadeEditable ? (
              <Tooltip
                title="Make this segmentation editable by adding a Volume Annotation Layer."
                placement="left"
              >
                <HoverIconButton
                  icon={<LockOutlined />}
                  hoveredIcon={<UnlockOutlined />}
                  onClick={() => {
                    this.setState({
                      isAddVolumeLayerModalVisible: true,
                      segmentationLayerWasPreselected: true,
                      preselectedSegmentationLayerName: layer.name,
                    });
                  }}
                />
              </Tooltip>
            ) : null}
          </div>
          <div className="flex-item">
            {isVolumeTracing ? (
              <Tooltip
                title={`This layer is a volume annotation.${
                  maybeFallbackLayer
                    ? ` It is based on the dataset's original layer ${maybeFallbackLayer}`
                    : ""
                }`}
                placement="left"
              >
                <i
                  className="fas fa-paint-brush"
                  style={{
                    opacity: 0.7,
                  }}
                />
              </Tooltip>
            ) : null}
          </div>
          <div className="flex-item">
            {intensityRange[0] === intensityRange[1] && !isDisabled ? (
              <Tooltip
                title={`No data is being rendered for this layer as the minimum and maximum of the range have the same values.
            If you want to hide this layer, you can also disable it with the switch on the left.`}
              >
                <WarningOutlined
                  style={{
                    color: "var(--ant-warning)",
                  }}
                />
              </Tooltip>
            ) : null}
            {isColorLayer ? null : this.getOptionalDownsampleVolumeIcon(maybeVolumeTracing)}
          </div>
        </div>

        <div className="flex-container">
          <div className="flex-item">
            {hasHistogram && !isDisabled ? this.getClipButton(layerName, isInEditMode) : null}
          </div>
          <div className="flex-item">
            {hasHistogram && !isDisabled ? this.getEditMinMaxButton(layerName, isInEditMode) : null}
          </div>
          <div className="flex-item">
            {isVolumeTracing && !isDisabled && maybeFallbackLayer != null
              ? this.getMergeWithFallbackLayerButton(layer)
              : null}
          </div>
          <div className="flex-item">
            {this.getFindDataButton(layerName, isDisabled, isColorLayer, maybeVolumeTracing)}
          </div>
          <div className="flex-item">{this.getReloadDataButton(layerName)}</div>
        </div>
      </div>
    );
  };

  getColorLayerSpecificSettings = (
    layerConfiguration: DatasetLayerConfiguration,
    layerName: string,
  ) => (
    <Row
      className="margin-bottom"
      style={{
        marginTop: 6,
      }}
    >
      <Col span={12}>
        <label className="setting-label">Color</label>
      </Col>
      <Col span={10}>
        <ColorSetting
          value={Utils.rgbToHex(layerConfiguration.color)}
          onChange={_.partial(this.props.onChangeLayer, layerName, "color")}
          style={{
            marginLeft: 6,
          }}
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
              top: 4,
              right: 0,
              marginTop: 0,
              display: "inline-flex",
            }}
          >
            <i
              className={classnames("fas", "fa-adjust", {
                "flip-horizontally": layerConfiguration.isInverted,
              })}
              style={{
                margin: 0,
                transition: "transform 0.5s ease 0s",
                color: layerConfiguration.isInverted
                  ? "var(--ant-primary)"
                  : "var(--ant-text-secondary)",
              }}
            />
          </div>
        </Tooltip>
      </Col>
    </Row>
  );

  getSegmentationSpecificSettings = (layerName: string) => {
    const segmentationOpacitySetting = (
      <NumberSliderSetting
        label={settings.segmentationPatternOpacity}
        min={0}
        max={100}
        step={1}
        value={this.props.datasetConfiguration.segmentationPatternOpacity}
        onChange={_.partial(this.props.onChange, "segmentationPatternOpacity")}
      />
    );
    return (
      <div>
        {segmentationOpacitySetting}
        <MappingSettingsView layerName={layerName} />
      </div>
    );
  };

  getLayerSettings = (
    layerName: string,
    layerConfiguration: DatasetLayerConfiguration | null | undefined,
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
          layerConfiguration,
        )}
        {isDisabled ? null : (
          <div
            style={{
              marginBottom: 30,
              marginLeft: 10,
            }}
          >
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
            {isColorLayer
              ? this.getColorLayerSpecificSettings(layerConfiguration, layerName)
              : this.getSegmentationSpecificSettings(layerName)}
          </div>
        )}
      </div>
    );
  };

  handleFindData = async (
    layerName: string,
    isDataLayer: boolean,
    volume: VolumeTracing | null | undefined,
  ) => {
    const { tracingStore } = Store.getState().tracing;
    const { dataset } = this.props;
    let foundPosition;
    let foundResolution;

    if (volume && !isDataLayer) {
      const { position, resolution } = await findDataPositionForVolumeTracing(
        tracingStore.url,
        volume.tracingId,
      );

      if ((!position || !resolution) && volume.fallbackLayer) {
        await this.handleFindData(volume.fallbackLayer, true, volume);
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
      const centerPosition = V3.add(lowerBoundary, upperBoundary).map(
        (el: number) => el / 2,
      ) as Vector3;
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

  getVolumeMagsToDownsample = (volumeTracing: VolumeTracing | null | undefined): Array<Vector3> => {
    if (this.props.task != null) {
      return [];
    }

    if (volumeTracing == null) {
      return [];
    }

    const segmentationLayer = Model.getSegmentationTracingLayer(volumeTracing.tracingId);
    const { fallbackLayerInfo } = segmentationLayer;
    const volumeTargetResolutions =
      fallbackLayerInfo != null
        ? fallbackLayerInfo.resolutions
        : getResolutions(this.props.dataset);

    const getMaxDim = (resolution: Vector3) => Math.max(...resolution);

    const volumeTracingResolutions = segmentationLayer.resolutions;

    const sourceMag = _.minBy(volumeTracingResolutions, getMaxDim);
    if (sourceMag === undefined) {
      return [];
    }

    const possibleMags = volumeTargetResolutions.filter(
      (resolution) => getMaxDim(resolution) >= getMaxDim(sourceMag),
    );

    const magsToDownsample = _.differenceWith(possibleMags, volumeTracingResolutions, _.isEqual);

    return magsToDownsample;
  };

  getOptionalDownsampleVolumeIcon = (volumeTracing: VolumeTracing | null | undefined) => {
    if (!volumeTracing) {
      return null;
    }

    const magsToDownsample = this.getVolumeMagsToDownsample(volumeTracing);
    const hasExtensiveResolutions = magsToDownsample.length === 0;

    if (hasExtensiveResolutions) {
      return null;
    }

    return (
      <Tooltip title="Open Dialog to Downsample Volume Data">
        <LinkButton onClick={() => this.showDownsampleVolumeModal(volumeTracing)}>
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
        </LinkButton>
      </Tooltip>
    );
  };

  getSkeletonLayer = () => {
    const { controlMode, tracing, onChangeRadius, userConfiguration, onChangeShowSkeletons } =
      this.props;
    const isPublicViewMode = controlMode === ControlModeEnum.VIEW;

    if (isPublicViewMode || tracing.skeleton == null) {
      return null;
    }

    const skeletonTracing = enforceSkeletonTracing(tracing);
    const { showSkeletons } = skeletonTracing;
    const activeNodeRadius = getActiveNode(skeletonTracing)
      .map((activeNode) => activeNode.radius)
      .getOrElse(0);
    return (
      <React.Fragment>
        <Tooltip
          title={showSkeletons ? "Hide skeleton layer" : "Show skeleton layer"}
          placement="top"
        >
          {/* This div is necessary for the tooltip to be displayed */}
          <div
            style={{
              display: "inline-block",
              marginRight: 8,
            }}
          >
            <Switch
              size="small"
              onChange={() => onChangeShowSkeletons(!showSkeletons)}
              checked={showSkeletons}
            />
          </div>
        </Tooltip>
        <span
          style={{
            fontWeight: 700,
            wordWrap: "break-word",
          }}
        >
          Skeleton
        </span>
        {showSkeletons ? (
          <div
            style={{
              marginLeft: 10,
            }}
          >
            <LogSliderSetting
              label="Node Radius"
              min={userSettings.nodeRadius.minimum}
              max={userSettings.nodeRadius.maximum}
              roundTo={0}
              value={activeNodeRadius}
              onChange={onChangeRadius}
              disabled={userConfiguration.overrideNodeRadius || activeNodeRadius === 0}
            />
            <NumberSliderSetting
              label={
                userConfiguration.overrideNodeRadius
                  ? settings.particleSize
                  : `Min. ${settings.particleSize}`
              }
              min={userSettings.particleSize.minimum}
              max={userSettings.particleSize.maximum}
              step={0.1}
              value={userConfiguration.particleSize}
              onChange={this.onChangeUser.particleSize}
            />
            {this.props.isArbitraryMode ? (
              <NumberSliderSetting
                label={settings.clippingDistanceArbitrary}
                min={userSettings.clippingDistanceArbitrary.minimum}
                max={userSettings.clippingDistanceArbitrary.maximum}
                value={userConfiguration.clippingDistanceArbitrary}
                onChange={this.onChangeUser.clippingDistanceArbitrary}
              />
            ) : (
              <LogSliderSetting
                label={settings.clippingDistance}
                roundTo={3}
                min={userSettings.clippingDistance.minimum}
                max={userSettings.clippingDistance.maximum}
                value={userConfiguration.clippingDistance}
                onChange={this.onChangeUser.clippingDistance}
              />
            )}
            <SwitchSetting
              label={settings.overrideNodeRadius}
              value={userConfiguration.overrideNodeRadius}
              onChange={this.onChangeUser.overrideNodeRadius}
            />
            <SwitchSetting
              label={settings.centerNewNode}
              value={userConfiguration.centerNewNode}
              onChange={this.onChangeUser.centerNewNode}
              tooltipText="When disabled, the active node will not be centered after node creation/deletion."
            />
            <SwitchSetting
              label={settings.highlightCommentedNodes}
              value={userConfiguration.highlightCommentedNodes}
              onChange={this.onChangeUser.highlightCommentedNodes}
            />{" "}
          </div>
        ) : null}
      </React.Fragment>
    );
  };

  showDownsampleVolumeModal = (volumeTracing: VolumeTracing) => {
    this.setState({
      volumeTracingToDownsample: volumeTracing,
    });
  };

  hideDownsampleVolumeModal = () => {
    this.setState({
      volumeTracingToDownsample: null,
    });
  };

  showAddVolumeLayerModal = () => {
    this.setState({
      isAddVolumeLayerModalVisible: true,
    });
  };

  hideAddVolumeLayerModal = () => {
    this.setState({
      isAddVolumeLayerModalVisible: false,
      segmentationLayerWasPreselected: false,
      preselectedSegmentationLayerName: undefined,
    });
  };

  addSkeletonAnnotationLayer = async () => {
    await Model.ensureSavedState();
    await convertToHybridTracing(this.props.tracing.annotationId, null);
    location.reload();
  };

  render() {
    const { layers } = this.props.datasetConfiguration;

    // Show color layer(s) first and then the segmentation layer(s).
    const layerSettings = _.sortBy(
      _.entries(layers).map((entry) => {
        const [layerName, layer] = entry;
        const isColorLayer = getIsColorLayer(this.props.dataset, layerName);
        return {
          layerName,
          layer,
          isColorLayer,
        };
      }),
      (el) => !el.isColorLayer,
    ).map((el) => this.getLayerSettings(el.layerName, el.layer, el.isColorLayer));

    const state = Store.getState();
    const canBeMadeHybrid =
      this.props.tracing.skeleton === null &&
      this.props.tracing.annotationType === APIAnnotationTypeEnum.Explorational &&
      state.task === null;
    return (
      <div className="tracing-settings-menu">
        {layerSettings}
        {this.getSkeletonLayer()}

        {this.props.tracing.restrictions.allowUpdate &&
        this.props.controlMode === ControlModeEnum.TRACE ? (
          <>
            <Divider />
            <Row justify="center" align="middle">
              <Button
                onClick={this.showAddVolumeLayerModal}
                style={{
                  width: 235,
                }}
              >
                <PlusOutlined />
                Add Volume Annotation Layer
              </Button>
            </Row>
          </>
        ) : null}

        {this.props.tracing.restrictions.allowUpdate && canBeMadeHybrid ? (
          <Row justify="center" align="middle">
            <Button
              onClick={this.addSkeletonAnnotationLayer}
              style={{
                width: 235,
                marginTop: 10,
              }}
            >
              <PlusOutlined />
              Add Skeleton Annotation Layer
            </Button>
          </Row>
        ) : null}

        {this.state.volumeTracingToDownsample != null ? (
          <DownsampleVolumeModal
            hideDownsampleVolumeModal={this.hideDownsampleVolumeModal}
            volumeTracing={this.state.volumeTracingToDownsample}
            magsToDownsample={this.getVolumeMagsToDownsample(this.state.volumeTracingToDownsample)}
          />
        ) : null}

        {this.state.layerToMergeWithFallback != null ? (
          <MaterializeVolumeAnnotationModal
            selectedVolumeLayer={this.state.layerToMergeWithFallback}
            handleClose={() => this.setState({ layerToMergeWithFallback: null })}
          />
        ) : null}

        {this.state.isAddVolumeLayerModalVisible ? (
          <AddVolumeLayerModal
            dataset={this.props.dataset}
            onCancel={this.hideAddVolumeLayerModal}
            tracing={this.props.tracing}
            preselectedLayerName={this.state.preselectedSegmentationLayerName}
            disableLayerSelection={this.state.segmentationLayerWasPreselected}
          />
        ) : null}
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  userConfiguration: state.userConfiguration,
  datasetConfiguration: state.datasetConfiguration,
  histogramData: state.temporaryConfiguration.histogramData,
  dataset: state.dataset,
  tracing: state.tracing,
  task: state.task,
  controlMode: state.temporaryConfiguration.controlMode,
  isArbitraryMode: Constants.MODES_ARBITRARY.includes(state.temporaryConfiguration.viewMode),
});

const mapDispatchToProps = (dispatch: Dispatch<any>) => ({
  onChange(propertyName: keyof DatasetConfiguration, value: ValueOf<DatasetConfiguration>) {
    dispatch(updateDatasetSettingAction(propertyName, value));
  },

  onChangeUser(propertyName: keyof UserConfiguration, value: ValueOf<UserConfiguration>) {
    dispatch(updateUserSettingAction(propertyName, value));
  },

  onChangeLayer(
    layerName: string,
    propertyName: keyof DatasetLayerConfiguration,
    value: ValueOf<DatasetLayerConfiguration>,
  ) {
    dispatch(updateLayerSettingAction(layerName, propertyName, value));
  },

  onClipHistogram(layerName: string, shouldAdjustClipRange: boolean) {
    return dispatchClipHistogramAsync(layerName, shouldAdjustClipRange, dispatch);
  },

  onChangeRadius(radius: number) {
    dispatch(setNodeRadiusAction(radius));
  },

  onSetPosition(position: Vector3) {
    dispatch(setPositionAction(position));
  },

  onChangeShowSkeletons(showSkeletons: boolean) {
    dispatch(setShowSkeletonsAction(showSkeletons));
  },

  onZoomToResolution(resolution: Vector3) {
    const targetZoomValue = getMaxZoomValueForResolution(Store.getState(), resolution);
    dispatch(setZoomStepAction(targetZoomValue));
    return targetZoomValue;
  },

  onEditAnnotationLayer(tracingId: string, layerProperties: EditableLayerProperties) {
    dispatch(editAnnotationLayerAction(tracingId, layerProperties));
  },
});

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(DatasetSettings);
