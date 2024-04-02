import { Button, Col, Divider, Dropdown, MenuProps, Modal, Row, Switch, Tooltip } from "antd";
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
  EllipsisOutlined,
  SaveOutlined,
  MenuOutlined,
} from "@ant-design/icons";
import ErrorHandling from "libs/error_handling";
import { connect, useDispatch, useSelector } from "react-redux";
import React from "react";
import _ from "lodash";
import classnames from "classnames";
import update from "immutability-helper";
import { SortableContainer, SortableElement, SortableHandle } from "react-sortable-hoc";
import {
  APIAnnotationTypeEnum,
  APIDataLayer,
  APIDataset,
  APISkeletonLayer,
  APIJobType,
  EditableLayerProperties,
} from "types/api_flow_types";
import { ValueOf } from "types/globals";
import { HoverIconButton } from "components/hover_icon_button";
import {
  SwitchSetting,
  NumberSliderSetting,
  LogSliderSetting,
  ColorSetting,
  SETTING_LEFT_SPAN,
  SETTING_MIDDLE_SPAN,
  SETTING_VALUE_SPAN,
} from "oxalis/view/components/setting_input_views";
import { M4x4, V3 } from "libs/mjs";
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
  deleteAnnotationLayer,
  updateDatasetDefaultConfiguration,
  startComputeSegmentIndexFileJob,
} from "admin/admin_rest_api";
import {
  getDefaultValueRangeOfLayer,
  getElementClass,
  isColorLayer as getIsColorLayer,
  getLayerByName,
  getResolutionInfo,
  getTransformsForLayerOrNull,
  getWidestResolutions,
  getLayerBoundingBox,
  getTransformsForLayer,
  hasDatasetTransforms,
} from "oxalis/model/accessors/dataset_accessor";
import { getMaxZoomValueForResolution, getPosition } from "oxalis/model/accessors/flycam_accessor";
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
  reloadHistogramAction,
} from "oxalis/model/actions/settings_actions";
import { userSettings } from "types/schemas/user_settings.schema";
import type { Vector3, ControlMode } from "oxalis/constants";
import Constants, { ControlModeEnum } from "oxalis/constants";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import LinkButton from "components/link_button";
import { Model } from "oxalis/singletons";
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
import { api } from "oxalis/singletons";
import {
  layerViewConfigurations,
  layerViewConfigurationTooltips,
  RecommendedConfiguration,
  settings,
  settingsTooltips,
} from "messages";
import { MaterializeVolumeAnnotationModal } from "oxalis/view/action-bar/starting_job_modals";
import AddVolumeLayerModal, { validateReadableLayerName } from "./modals/add_volume_layer_modal";
import DownsampleVolumeModal from "./modals/downsample_volume_modal";
import Histogram, { isHistogramSupported } from "./histogram_view";
import MappingSettingsView from "./mapping_settings_view";
import { confirmAsync } from "../../../dashboard/dataset/helper_components";
import {
  invertTransform,
  transformPointUnscaled,
} from "oxalis/model/helpers/transformation_helpers";

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
  onZoomToResolution: (layerName: string, arg0: Vector3) => number;
  onChangeUser: (key: keyof UserConfiguration, value: any) => void;
  reloadHistogram: (layerName: string) => void;
  tracing: Tracing;
  task: Task | null | undefined;
  onEditAnnotationLayer: (tracingId: string, layerProperties: EditableLayerProperties) => void;
  controlMode: ControlMode;
  isArbitraryMode: boolean;
  isAdminOrDatasetManager: boolean;
  isSuperUser: boolean;
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

const SortableLayerSettingsContainer = SortableContainer(({ children }: { children: any }) => {
  return <div>{children}</div>;
});

type DragHandleProps = {
  hasLessThanTwoColorLayers: boolean;
};

function dragHandleIcon(isDisabled: boolean = false) {
  return (
    <div
      style={{
        display: "inline-flex",
        justifyContent: "center",
        cursor: "grab",
        alignItems: "center",
        color: isDisabled ? "rgba(0, 0, 0, 0.25)" : "rgba(0, 0, 0, 0.60)",
      }}
    >
      <MenuOutlined
        style={{
          display: "inline-block",
          marginRight: 8,
        }}
      />
    </div>
  );
}
const DragHandle = SortableHandle(({ hasLessThanTwoColorLayers }: DragHandleProps) => {
  return hasLessThanTwoColorLayers ? (
    <Tooltip title="Order is only changeable with more than one color layer.">
      {dragHandleIcon(true)}
    </Tooltip>
  ) : (
    dragHandleIcon()
  );
});

function DummyDragHandle({ layerType }: { layerType: string }) {
  return (
    <Tooltip title={`Layer not movable: ${layerType} layers are always rendered on top.`}>
      {dragHandleIcon(true)}
    </Tooltip>
  );
}

function TransformationIcon({ layer }: { layer: APIDataLayer | APISkeletonLayer }) {
  const dispatch = useDispatch();
  const transform = useSelector((state: OxalisState) =>
    getTransformsForLayerOrNull(
      state.dataset,
      layer,
      state.datasetConfiguration.nativelyRenderedLayerName,
    ),
  );
  const showIcon = useSelector((state: OxalisState) => hasDatasetTransforms(state.dataset));
  if (!showIcon) {
    return null;
  }

  const typeToLabel = {
    affine: "an affine",
    thin_plate_spline: "a thin-plate-spline",
  };

  const typeToImage = {
    none: "icon-no-transformation.svg",
    thin_plate_spline: "icon-tps-transformation.svg",
    affine: "icon-affine-transformation.svg",
  };

  const toggleLayerTransforms = () => {
    const state = Store.getState();
    const { nativelyRenderedLayerName } = state.datasetConfiguration;
    if (
      layer.category === "skeleton"
        ? nativelyRenderedLayerName == null
        : nativelyRenderedLayerName === layer.name
    ) {
      return;
    }
    // Transform current position using the inverse transform
    // so that the user will still look at the same data location.
    const currentPosition = getPosition(state.flycam);
    const currentTransforms = getTransformsForLayer(
      state.dataset,
      layer,
      state.datasetConfiguration.nativelyRenderedLayerName,
    );
    const invertedTransform = invertTransform(currentTransforms);
    const newPosition = transformPointUnscaled(invertedTransform)(currentPosition);

    // Also transform a reference coordinate to determine how the scaling
    // changed. Then, adapt the zoom accordingly.
    const referenceOffset: Vector3 = [10, 10, 10];
    const secondPosition = V3.add(currentPosition, referenceOffset, [0, 0, 0]);
    const newSecondPosition = transformPointUnscaled(invertedTransform)(secondPosition);

    const scaleChange = _.mean(
      // Only consider XY for now to determine the zoom change (by slicing from 0 to 2)
      V3.abs(V3.divide3(V3.sub(newPosition, newSecondPosition), referenceOffset)).slice(0, 2),
    );
    dispatch(
      updateDatasetSettingAction(
        "nativelyRenderedLayerName",
        layer.category === "skeleton" ? null : layer.name,
      ),
    );
    dispatch(setPositionAction(newPosition));
    dispatch(setZoomStepAction(state.flycam.zoomStep * scaleChange));
  };

  return (
    <div className="flex-item">
      <Tooltip
        title={
          transform != null
            ? `This layer is rendered with ${
                typeToLabel[transform.type]
              } transformation. Click to render this layer without any transforms.`
            : "This layer is shown natively (i.e., without any transformations)."
        }
      >
        <img
          src={`/assets/images/${typeToImage[transform?.type || "none"]}`}
          alt="Transformed Layer Icon"
          style={{
            cursor: transform != null ? "pointer" : "default",
            width: 14,
            height: 14,
            marginBottom: 4,
            marginRight: 5,
          }}
          onClick={toggleLayerTransforms}
        />
      </Tooltip>
    </div>
  );
}

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
      : "If you are having trouble finding your data, WEBKNOSSOS can try to find a position which contains data.";

    if (!isColorLayer && maybeVolumeTracing && maybeVolumeTracing.fallbackLayer) {
      tooltipText =
        "WEBKNOSSOS will try to find data in your volume tracing first and in the fallback layer afterwards.";
    }

    return (
      <Tooltip title={tooltipText}>
        <div
          onClick={
            !isDisabled
              ? () => this.handleFindData(layerName, isColorLayer, maybeVolumeTracing)
              : () => Promise.resolve()
          }
          style={{
            cursor: !isDisabled ? "pointer" : "not-allowed",
          }}
        >
          <ScanOutlined className="icon-margin-right" />
          Jump to data
        </div>
      </Tooltip>
    );
  };

  getReloadDataButton = (layerName: string) => {
    const tooltipText = "Use this when the data on the server changed.";
    return (
      <Tooltip title={tooltipText}>
        <div onClick={() => this.reloadLayerData(layerName)}>
          <ReloadOutlined className="icon-margin-right" />
          Reload data from server
        </div>
      </Tooltip>
    );
  };

  getEditMinMaxButton = (layerName: string, isInEditMode: boolean) => {
    const tooltipText = isInEditMode
      ? "Stop editing the possible range of the histogram."
      : "Manually set the possible range of the histogram.";
    return (
      <Tooltip title={tooltipText}>
        <div onClick={() => this.props.onChangeLayer(layerName, "isInEditMode", !isInEditMode)}>
          <EditOutlined
            style={{
              cursor: "pointer",
              color: isInEditMode ? "var(--ant-color-primary)" : undefined,
            }}
            className="icon-margin-right"
          />
          {isInEditMode ? "Stop editing" : "Edit"} histogram range
        </div>
      </Tooltip>
    );
  };

  getMergeWithFallbackLayerButton = (layer: APIDataLayer) => (
    <div onClick={() => this.setState({ layerToMergeWithFallback: layer })}>
      <i className="fas fa-object-ungroup icon-margin-right" />
      Merge this volume annotation with its fallback layer
    </div>
  );

  getDeleteAnnotationLayerButton = (readableName: string, layer?: APIDataLayer) => (
    <div className="flex-item">
      <Tooltip title="Delete this annotation layer.">
        <i
          onClick={() => this.deleteAnnotationLayerIfConfirmed(readableName, layer)}
          className="fas fa-trash icon-margin-right"
        />
      </Tooltip>
    </div>
  );

  getDeleteAnnotationLayerDropdownOption = (readableName: string, layer?: APIDataLayer) => (
    <div onClick={() => this.deleteAnnotationLayerIfConfirmed(readableName, layer)}>
      <i className="fas fa-trash icon-margin-right" />
      Delete this annotation layer
    </div>
  );

  deleteAnnotationLayerIfConfirmed = async (
    readableAnnoationLayerName: string,
    layer?: APIDataLayer,
  ) => {
    const fallbackLayerNote =
      layer && layer.category === "segmentation" && layer.fallbackLayer
        ? "Changes to the original segmentation layer will be discarded and the original state will be displayed again. "
        : "";
    const shouldDelete = await confirmAsync({
      title: `Deleting an annotation layer makes its content and history inaccessible. ${fallbackLayerNote}This cannot be undone. Are you sure you want to delete this layer?`,
      okText: `Yes, delete annotation layer “${readableAnnoationLayerName}”`,
      cancelText: "Cancel",
      maskClosable: true,
      closable: true,
      okButtonProps: {
        danger: true,
        block: true,
        style: { whiteSpace: "normal", height: "auto", margin: "10px 0 0 0" },
      },
      cancelButtonProps: {
        block: true,
      },
    });
    if (!shouldDelete) return;
    await Model.ensureSavedState();
    await deleteAnnotationLayer(
      this.props.tracing.annotationId,
      this.props.tracing.annotationType,
      readableAnnoationLayerName,
    );
    location.reload();
  };

  getClipButton = (layerName: string, isInEditMode: boolean) => {
    const editModeAddendum = isInEditMode
      ? "In Edit Mode, the histogram's range will be adjusted, too."
      : "";
    const tooltipText = `Automatically clip the histogram to enhance contrast. ${editModeAddendum}`;
    return (
      <Tooltip title={tooltipText}>
        <div onClick={() => this.props.onClipHistogram(layerName, isInEditMode)}>
          <VerticalAlignMiddleOutlined
            style={{
              cursor: "pointer",
              transform: "rotate(90deg)",
            }}
            className="icon-margin-right"
          />
          Clip histogram
        </div>
      </Tooltip>
    );
  };

  getComputeSegmentIndexFileButton = (layerName: string, isSegmentation: boolean) => {
    if (!(this.props.isSuperUser && isSegmentation)) return <></>;

    const triggerComputeSegmentIndexFileJob = async () => {
      await startComputeSegmentIndexFileJob(
        this.props.dataset.owningOrganization,
        this.props.dataset.name,
        layerName,
      );
      Toast.info(
        <React.Fragment>
          Started a job for computating a segment index file.
          <br />
          See{" "}
          <a target="_blank" href="/jobs" rel="noopener noreferrer">
            Processing Jobs
          </a>{" "}
          for an overview of running jobs.
        </React.Fragment>,
      );
    };

    return (
      <div onClick={triggerComputeSegmentIndexFileJob}>
        <i className="fas fa-database icon-margin-right" />
        Compute a Segment Index file
      </div>
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
    onChange: (arg0: boolean, arg1: React.MouseEvent<HTMLButtonElement>) => void,
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
    if (!intensityRange) {
      return null;
    }
    const defaultIntensityRange = getDefaultValueRangeOfLayer(this.props.dataset, layerName);
    const histograms = this.props.histogramData?.[layerName];

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
        reloadHistogram={() => this.reloadHistogram(layerName)}
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
    hasLessThanTwoColorLayers: boolean = true,
  ) => {
    const { tracing, dataset } = this.props;
    const { intensityRange } = layerSettings;
    const layer = getLayerByName(dataset, layerName);
    const isSegmentation = layer.category === "segmentation";
    const canBeMadeEditable =
      isSegmentation && layer.tracingId == null && this.props.controlMode === "TRACE";
    const isVolumeTracing = isSegmentation ? layer.tracingId != null : false;
    const isAnnotationLayer = isSegmentation && layer.tracingId != null;
    const isOnlyAnnotationLayer =
      isAnnotationLayer && tracing && tracing.annotationLayers.length === 1;
    const maybeTracingId = isSegmentation ? layer.tracingId : null;
    const maybeVolumeTracing =
      maybeTracingId != null ? getVolumeTracingById(tracing, maybeTracingId) : null;
    const maybeFallbackLayer =
      maybeVolumeTracing?.fallbackLayer != null ? maybeVolumeTracing.fallbackLayer : null;

    const setSingleLayerVisibility = (isVisible: boolean) => {
      this.props.onChangeLayer(layerName, "isDisabled", !isVisible);
    };

    const onChange = (value: boolean, event: React.MouseEvent<HTMLButtonElement>) => {
      if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
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
    const resolutionInfo = getResolutionInfo(layer.resolutions);
    const resolutions = resolutionInfo.getResolutionList();
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
    const possibleItems: MenuProps["items"] = [
      isVolumeTracing && !isDisabled && maybeFallbackLayer != null
        ? {
            label: this.getMergeWithFallbackLayerButton(layer),
            key: "mergeWithFallbackLayerButton",
          }
        : null,
      this.props.dataset.isEditable
        ? { label: this.getReloadDataButton(layerName), key: "reloadDataButton" }
        : null,
      {
        label: this.getFindDataButton(layerName, isDisabled, isColorLayer, maybeVolumeTracing),
        key: "findDataButton",
      },
      isAnnotationLayer && !isOnlyAnnotationLayer
        ? {
            label: (
              <div className="flex-item">
                {this.getDeleteAnnotationLayerDropdownOption(readableName, layer)}
              </div>
            ),
            key: "deleteAnnotationLayer",
          }
        : null,
      hasHistogram && !isDisabled
        ? { label: this.getEditMinMaxButton(layerName, isInEditMode), key: "editMinMax" }
        : null,
      hasHistogram && !isDisabled
        ? { label: this.getClipButton(layerName, isInEditMode), key: "clipButton" }
        : null,
      this.props.dataset.dataStore.jobsEnabled &&
      this.props.dataset.dataStore.jobsSupportedByAvailableWorkers.includes(
        APIJobType.COMPUTE_SEGMENT_INDEX_FILE,
      )
        ? {
            label: this.getComputeSegmentIndexFileButton(layerName, isSegmentation),
            key: "computeSegmentIndexFileButton",
          }
        : null,
    ];
    const items = possibleItems.filter((el) => el);
    return (
      <div className="flex-container">
        {isColorLayer ? (
          <DragHandle hasLessThanTwoColorLayers={hasLessThanTwoColorLayers} />
        ) : (
          <DummyDragHandle layerType="Volume" />
        )}
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
              <InfoCircleOutlined className="icon-margin-right" />
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
          <TransformationIcon layer={layer} />
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
                  className="fas fa-paint-brush icon-margin-right"
                  style={{
                    opacity: 0.7,
                  }}
                />
              </Tooltip>
            ) : null}
          </div>
          <div className="flex-item">
            {intensityRange != null && intensityRange[0] === intensityRange[1] && !isDisabled ? (
              <Tooltip
                title={`No data is being rendered for this layer as the minimum and maximum of the range have the same values.
            If you want to hide this layer, you can also disable it with the switch on the left.`}
              >
                <WarningOutlined
                  style={{
                    color: "var(--ant-color-warning)",
                  }}
                />
              </Tooltip>
            ) : null}
            {isColorLayer ? null : this.getOptionalDownsampleVolumeIcon(maybeVolumeTracing)}
          </div>
        </div>
        <Dropdown menu={{ items }} trigger={["hover"]} placement="bottomRight">
          <div className="flex-container" style={{ cursor: "pointer" }}>
            <div className="flex-item">
              <EllipsisOutlined />
            </div>
          </div>
        </Dropdown>
      </div>
    );
  };

  getColorLayerSpecificSettings = (
    layerConfiguration: DatasetLayerConfiguration,
    layerName: string,
  ) => (
    <div>
      <LogSliderSetting
        label={
          <Tooltip title={layerViewConfigurationTooltips.gammaCorrectionValue}>
            {layerViewConfigurations.gammaCorrectionValue}
          </Tooltip>
        }
        min={0.01}
        max={10}
        roundTo={3}
        value={layerConfiguration.gammaCorrectionValue}
        onChange={_.partial(this.props.onChangeLayer, layerName, "gammaCorrectionValue")}
      />
      <Row
        className="margin-bottom"
        style={{
          marginTop: 6,
        }}
      >
        <Col span={SETTING_LEFT_SPAN}>
          <label className="setting-label">Color</label>
        </Col>
        <Col span={SETTING_MIDDLE_SPAN}>
          <ColorSetting
            value={Utils.rgbToHex(layerConfiguration.color)}
            onChange={_.partial(this.props.onChangeLayer, layerName, "color")}
            style={{
              marginLeft: 6,
            }}
          />
        </Col>
        <Col span={SETTING_VALUE_SPAN}>
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
                marginLeft: 10,
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
                    ? "var(--ant-color-primary)"
                    : "var(--ant-color-text-secondary)",
                }}
              />
            </div>
          </Tooltip>
        </Col>
      </Row>
    </div>
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

  LayerSettings = ({
    layerName,
    layerConfiguration,
    isColorLayer,
    hasLessThanTwoColorLayers = true,
  }: {
    layerName: string;
    layerConfiguration: DatasetLayerConfiguration | null | undefined;
    isColorLayer: boolean;
    hasLessThanTwoColorLayers?: boolean;
  }) => {
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
          hasLessThanTwoColorLayers,
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

  SortableLayerSettings = SortableElement(this.LayerSettings);

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

    if (foundPosition && foundResolution) {
      const layer = getLayerByName(dataset, layerName, true);
      const transformMatrix = getTransformsForLayerOrNull(
        dataset,
        layer,
        Store.getState().datasetConfiguration.nativelyRenderedLayerName,
      )?.affineMatrix;
      if (transformMatrix) {
        const matrix = M4x4.transpose(transformMatrix);
        // Transform the found position according to the matrix.
        V3.mul4x4(matrix, foundPosition, foundPosition);
      }
    } else {
      const centerPosition = getLayerBoundingBox(dataset, layerName).getCenter();
      Toast.warning(
        `Couldn't find data within layer "${layerName}." Jumping to the center of the layer's bounding box.`,
      );
      this.props.onSetPosition(centerPosition);
      return;
    }

    this.props.onSetPosition(foundPosition);
    const zoomValue = this.props.onZoomToResolution(layerName, foundResolution);
    Toast.success(
      `Jumping to position ${foundPosition
        .map((el) => Math.floor(el))
        .join(", ")} and zooming to ${zoomValue.toFixed(2)}`,
    );
  };

  reloadLayerData = async (layerName: string): Promise<void> => {
    await clearCache(this.props.dataset, layerName);
    this.props.reloadHistogram(layerName);
    await api.data.reloadBuckets(layerName);
    Toast.success(`Successfully reloaded data of layer ${layerName}.`);
  };

  reloadHistogram = async (layerName: string): Promise<void> => {
    await clearCache(this.props.dataset, layerName);
    this.props.reloadHistogram(layerName);
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
        : // This is only a heuristic. At some point, user configuration
          // might make sense here.
          getWidestResolutions(this.props.dataset);

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

    const readableName = "Skeleton";
    const skeletonTracing = enforceSkeletonTracing(tracing);
    const isOnlyAnnotationLayer = tracing.annotationLayers.length === 1;
    const { showSkeletons } = skeletonTracing;
    const activeNodeRadius = getActiveNode(skeletonTracing)
      .map((activeNode) => activeNode.radius)
      .getOrElse(0);
    return (
      <React.Fragment>
        <div
          className="flex-container"
          style={{
            paddingRight: 1,
          }}
        >
          <DummyDragHandle layerType="Skeleton" />
          <div
            className="flex-item"
            style={{
              marginRight: 8,
            }}
          >
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
              {readableName}
            </span>
          </div>
          <div
            className="flex-container"
            style={{
              paddingRight: 1,
            }}
          >
            <TransformationIcon layer={{ category: "skeleton" }} />
            {!isOnlyAnnotationLayer ? this.getDeleteAnnotationLayerButton(readableName) : null}
          </div>
        </div>
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

  saveViewConfigurationAsDefault = () => {
    const { dataset, datasetConfiguration } = this.props;
    const dataSource: Array<{
      name: string;
      description?: string;
    }> = [{ name: "Position" }, { name: "Zoom" }, { name: "Rotation" }];
    const additionalData: typeof dataSource = (
      [
        "fourBit",
        "interpolation",
        "renderMissingDataBlack",
        "loadingStrategy",
        "segmentationPatternOpacity",
        "blendMode",
      ] as Array<keyof RecommendedConfiguration>
    ).map((key) => ({
      name: settings[key] as string,
      description: settingsTooltips[key],
    }));
    dataSource.push(...additionalData);
    Modal.confirm({
      title: "Save current view configuration as default?",
      width: 700,
      content: (
        <>
          Do you really want to save your current view configuration as the dataset's default?
          <br />
          This will overwrite the current default view configuration.
          <br />
          This includes all color and segmentation layer settings, as well as these additional
          settings:
          <br />
          <br />
          {dataSource.map((field, index) => {
            let delimiter = index === dataSource.length - 1 ? "" : ", ";
            delimiter = index === dataSource.length - 2 ? " and " : delimiter;
            return field.description ? (
              <>
                {field.name}{" "}
                <Tooltip title={field.description}>
                  <InfoCircleOutlined style={{ color: "gray", marginRight: 0 }} />
                </Tooltip>
                {delimiter}
              </>
            ) : (
              `${field.name}${delimiter}`
            );
          })}
          .
        </>
      ),
      onOk: async () => {
        try {
          const { flycam } = Store.getState();
          const position = V3.floor(getPosition(flycam));
          const zoom = flycam.zoomStep;
          const completeDatasetConfiguration = Object.assign({}, datasetConfiguration, {
            position,
            zoom,
          });
          await updateDatasetDefaultConfiguration(dataset, completeDatasetConfiguration);
          Toast.success("Successfully saved the current view configuration as default.");
        } catch (error) {
          Toast.error(
            "Failed to save the current view configuration as default. Please look at the console for more details.",
          );
          ErrorHandling.notify(error as Error);
          console.error(error);
        }
      },
    });
  };

  onSortLayerSettingsEnd = ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => {
    // Fix for having a grabbing cursor during dragging from https://github.com/clauderic/react-sortable-hoc/issues/328#issuecomment-1005835670.
    document.body.classList.remove("is-dragging");
    const { colorLayerOrder } = this.props.datasetConfiguration;
    const movedElement = colorLayerOrder[oldIndex];
    newIndex = Math.min(newIndex, colorLayerOrder.length - 1);
    const newLayerOrder = update(colorLayerOrder, {
      $splice: [
        [oldIndex, 1],
        [newIndex, 0, movedElement],
      ],
    });
    this.props.onChange("colorLayerOrder", newLayerOrder);
  };

  render() {
    const { layers, colorLayerOrder } = this.props.datasetConfiguration;
    const LayerSettings = this.LayerSettings;
    const SortableLayerSettings = this.SortableLayerSettings;

    const segmentationLayerNames = Object.keys(layers).filter(
      (layerName) => !getIsColorLayer(this.props.dataset, layerName),
    );
    const hasLessThanTwoColorLayers = colorLayerOrder.length < 2;
    const colorLayerSettings = colorLayerOrder.map((layerName, index) => {
      return (
        <SortableLayerSettings
          key={layerName}
          layerName={layerName}
          layerConfiguration={layers[layerName]}
          isColorLayer
          index={index}
          disabled={hasLessThanTwoColorLayers}
          hasLessThanTwoColorLayers={hasLessThanTwoColorLayers}
        />
      );
    });
    const segmentationLayerSettings = segmentationLayerNames.map((layerName) => {
      return (
        <LayerSettings
          key={layerName}
          layerName={layerName}
          layerConfiguration={layers[layerName]}
          isColorLayer={false}
        />
      );
    });

    const state = Store.getState();
    const canBeMadeHybrid =
      this.props.tracing.skeleton === null &&
      this.props.tracing.annotationType === APIAnnotationTypeEnum.Explorational &&
      state.task === null;
    return (
      <div className="tracing-settings-menu">
        <SortableLayerSettingsContainer
          onSortEnd={this.onSortLayerSettingsEnd}
          onSortStart={() =>
            colorLayerOrder.length > 1 && document.body.classList.add("is-dragging")
          }
          useDragHandle
        >
          {colorLayerSettings}
        </SortableLayerSettingsContainer>
        {segmentationLayerSettings}
        {this.getSkeletonLayer()}

        {this.props.tracing.restrictions.allowUpdate &&
        this.props.controlMode === ControlModeEnum.TRACE ? (
          <>
            <Divider />
            <Row justify="center" align="middle">
              <Button onClick={this.showAddVolumeLayerModal}>
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
                marginTop: 10,
              }}
            >
              <PlusOutlined />
              Add Skeleton Annotation Layer
            </Button>
          </Row>
        ) : null}

        {this.props.controlMode === ControlModeEnum.VIEW && this.props.isAdminOrDatasetManager ? (
          <Row justify="center" align="middle">
            <Tooltip title="Save the current view configuration as default for all users.">
              <Button onClick={this.saveViewConfigurationAsDefault}>
                <SaveOutlined />
                Save View Configuration as Default
              </Button>
            </Tooltip>
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
  isAdminOrDatasetManager:
    state.activeUser != null ? Utils.isUserAdminOrDatasetManager(state.activeUser) : false,
  isSuperUser: state.activeUser?.isSuperUser || false,
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

  onZoomToResolution(layerName: string, resolution: Vector3) {
    const targetZoomValue = getMaxZoomValueForResolution(Store.getState(), layerName, resolution);
    dispatch(setZoomStepAction(targetZoomValue));
    return targetZoomValue;
  },

  onEditAnnotationLayer(tracingId: string, layerProperties: EditableLayerProperties) {
    dispatch(editAnnotationLayerAction(tracingId, layerProperties));
  },

  reloadHistogram(layerName: string) {
    dispatch(reloadHistogramAction(layerName));
  },
});

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(DatasetSettings);
