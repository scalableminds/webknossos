import {
  EditOutlined,
  EllipsisOutlined,
  InfoCircleOutlined,
  LockOutlined,
  MenuOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  ScanOutlined,
  UnlockOutlined,
  VerticalAlignMiddleOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  clearCache,
  findDataPositionForLayer,
  findDataPositionForVolumeTracing,
  startComputeSegmentIndexFileJob,
  updateDatasetDefaultConfiguration,
} from "admin/rest_api";
import { Button, Col, Divider, Dropdown, type MenuProps, Modal, Row, Switch } from "antd";
import type { SwitchChangeEventHandler } from "antd/es/switch";
import classnames from "classnames";
import FastTooltip from "components/fast_tooltip";
import { HoverIconButton } from "components/hover_icon_button";
import update from "immutability-helper";
import ErrorHandling from "libs/error_handling";
import { M4x4, V3 } from "libs/mjs";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import _ from "lodash";
import {
  type RecommendedConfiguration,
  layerViewConfigurationTooltips,
  layerViewConfigurations,
  settings,
  settingsTooltips,
} from "messages";
import React, { useCallback } from "react";
import { connect, useDispatch } from "react-redux";
import type { Dispatch } from "redux";
import {
  APIAnnotationTypeEnum,
  type APIDataLayer,
  type APIDataset,
  APIJobType,
  type APISkeletonLayer,
  AnnotationLayerEnum,
  type AnnotationLayerType,
  type EditableLayerProperties,
} from "types/api_types";
import type { ValueOf } from "types/globals";
import {
  defaultDatasetViewConfiguration,
  getDefaultLayerViewConfiguration,
} from "types/schemas/dataset_view_configuration.schema";
import { getSpecificDefaultsForLayer } from "types/schemas/dataset_view_configuration_defaults";
import { userSettings } from "types/schemas/user_settings.schema";
import type { Vector3 } from "viewer/constants";
import Constants, { ControlModeEnum, IdentityTransform, MappingStatusEnum } from "viewer/constants";
import defaultState from "viewer/default_state";
import {
  getDefaultValueRangeOfLayer,
  getElementClass,
  isColorLayer as getIsColorLayer,
  getLayerBoundingBox,
  getLayerByName,
  getMagInfo,
  getWidestMags,
} from "viewer/model/accessors/dataset_accessor";
import {
  getTransformsForLayer,
  getTransformsForLayerOrNull,
  hasDatasetTransforms,
  isLayerWithoutTransformationConfigSupport,
} from "viewer/model/accessors/dataset_layer_transformation_accessor";
import {
  getMaxZoomValueForMag,
  getNewPositionAndZoomChangeFromTransformationChange,
  getPosition,
} from "viewer/model/accessors/flycam_accessor";
import {
  enforceSkeletonTracing,
  getActiveNode,
} from "viewer/model/accessors/skeletontracing_accessor";
import {
  getAllReadableLayerNames,
  getReadableNameByVolumeTracingId,
  getVolumeDescriptorById,
  getVolumeTracingById,
} from "viewer/model/accessors/volumetracing_accessor";
import { editAnnotationLayerAction } from "viewer/model/actions/annotation_actions";
import { setPositionAction, setZoomStepAction } from "viewer/model/actions/flycam_actions";
import {
  pushSaveQueueTransaction,
  pushSaveQueueTransactionIsolated,
} from "viewer/model/actions/save_actions";
import {
  dispatchClipHistogramAsync,
  reloadHistogramAction,
  updateDatasetSettingAction,
  updateLayerSettingAction,
  updateUserSettingAction,
} from "viewer/model/actions/settings_actions";
import {
  setNodeRadiusAction,
  setShowSkeletonsAction,
} from "viewer/model/actions/skeletontracing_actions";
import {
  addLayerToAnnotation,
  deleteAnnotationLayer,
} from "viewer/model/sagas/volume/update_actions";
import { Model, api } from "viewer/singletons";
import type {
  DatasetConfiguration,
  DatasetLayerConfiguration,
  UserConfiguration,
  VolumeTracing,
  WebknossosState,
} from "viewer/store";
import Store from "viewer/store";
import { MaterializeVolumeAnnotationModal } from "viewer/view/action-bar/starting_job_modals";
import EditableTextLabel from "viewer/view/components/editable_text_label";
import {
  ColorSetting,
  LogSliderSetting,
  NumberSliderSetting,
  SETTING_LEFT_SPAN,
  SETTING_MIDDLE_SPAN,
  SETTING_VALUE_SPAN,
  SwitchSetting,
} from "viewer/view/components/setting_input_views";
import { confirmAsync } from "../../../dashboard/dataset/helper_components";
import { HideUnregisteredSegmentsSwitch } from "./hide_unregistered_segments_switch";
import Histogram, { isHistogramSupported } from "./histogram_view";
import MappingSettingsView from "./mapping_settings_view";
import AddVolumeLayerModal, { validateReadableLayerName } from "./modals/add_volume_layer_modal";

type DatasetSettingsProps = ReturnType<typeof mapStateToProps> &
  ReturnType<typeof mapDispatchToProps>;

type State = {
  isAddVolumeLayerModalVisible: boolean;
  preselectedSegmentationLayerName: string | undefined;
  segmentationLayerWasPreselected: boolean | undefined;
  layerToMergeWithFallback: APIDataLayer | null | undefined;
};

function DragHandleIcon({ isDisabled = false }: { isDisabled?: boolean }) {
  return (
    <div
      style={{
        display: "inline-flex",
        justifyContent: "center",
        cursor: "grab",
        alignItems: "center",
        opacity: isDisabled ? 0.3 : 0.6,
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
function DragHandle({ id }: { id: string }) {
  const { attributes, listeners } = useSortable({
    id,
  });

  return (
    <div {...attributes} {...listeners}>
      <DragHandleIcon />
    </div>
  );
}

function DummyDragHandle({ tooltipTitle }: { tooltipTitle: string }) {
  return (
    <FastTooltip
      title={tooltipTitle}
      style={{ justifyContent: "center", alignItems: "center", display: "flex" }}
    >
      <DragHandleIcon isDisabled />
    </FastTooltip>
  );
}

function TransformationIcon({ layer }: { layer: APIDataLayer | APISkeletonLayer }) {
  const dispatch = useDispatch();
  const transform = useWkSelector((state) =>
    getTransformsForLayerOrNull(
      state.dataset,
      layer,
      state.datasetConfiguration.nativelyRenderedLayerName,
    ),
  );
  const canLayerHaveTransforms = !isLayerWithoutTransformationConfigSupport(layer);
  const hasLayerTransformsConfigured = useWkSelector(
    (state) => getTransformsForLayerOrNull(state.dataset, layer, null) != null,
  );

  const showIcon = useWkSelector((state) => hasDatasetTransforms(state.dataset));
  if (!showIcon) {
    return null;
  }
  const isRenderedNatively = transform == null || transform === IdentityTransform;

  const typeToLabel = {
    affine: "an affine",
    thin_plate_spline: "a thin-plate-spline",
  };

  const typeToImage = {
    none: "icon-no-transformation.svg",
    thin_plate_spline: "icon-tps-transformation.svg",
    affine: "icon-affine-transformation.svg",
  };

  // Cannot toggle transforms for a layer that cannot have no transforms or turn them on in case the layer has no transforms.
  // Layers that cannot have transformations like skeleton layer and volume tracing layers without fallback
  // automatically copy to the dataset transformation if all other layers have the same transformation.
  const isDisabled =
    !canLayerHaveTransforms || (isRenderedNatively && !hasLayerTransformsConfigured);

  const toggleLayerTransforms = () => {
    const state = Store.getState();
    // Set nativelyRenderedLayerName to null in case the current layer is already natively rendered or does not have its own transformations configured (e.g. a skeleton layer) .
    const nextNativelyRenderedLayerName = isRenderedNatively ? null : layer.name;
    const activeTransformation = getTransformsForLayer(
      state.dataset,
      layer,
      state.datasetConfiguration.nativelyRenderedLayerName,
    );
    const nextTransform = getTransformsForLayer(
      state.dataset,
      layer,
      nextNativelyRenderedLayerName,
    );
    const { scaleChange, newPosition } = getNewPositionAndZoomChangeFromTransformationChange(
      activeTransformation,
      nextTransform,
      state,
    );
    dispatch(
      updateDatasetSettingAction("nativelyRenderedLayerName", nextNativelyRenderedLayerName),
    );
    dispatch(setPositionAction(newPosition));
    dispatch(setZoomStepAction(state.flycam.zoomStep * scaleChange));
  };

  const style = {
    width: 14,
    height: 14,
    marginBottom: 4,
    marginRight: 5,
    ...(isDisabled
      ? { cursor: "not-allowed", opacity: "0.5" }
      : { cursor: "pointer", opacity: "1.0" }),
  };

  return (
    <div className="flex-item">
      <FastTooltip
        title={
          isRenderedNatively
            ? `This layer is shown natively (i.e., without any transformations).${isDisabled ? "" : " Click to render this layer with its configured transforms."}`
            : `This layer is rendered with ${
                typeToLabel[transform.type]
              } transformation.${isDisabled ? "" : " Click to render this layer without any transforms."}`
        }
      >
        <img
          src={`/assets/images/${typeToImage[isRenderedNatively ? "none" : transform.type]}`}
          alt="Transformed Layer Icon"
          style={style}
          onClick={isDisabled ? () => {} : toggleLayerTransforms}
        />
      </FastTooltip>
    </div>
  );
}

function LayerInfoIconWithTooltip({
  layer,
  dataset,
}: { layer: APIDataLayer; dataset: APIDataset }) {
  const renderTooltipContent = useCallback(() => {
    const elementClass = getElementClass(dataset, layer.name);
    const magInfo = getMagInfo(layer.resolutions);
    const mags = magInfo.getMagList();
    return (
      <div>
        <div>Data Type: {elementClass}</div>
        <div>
          Available magnifications:
          <ul>
            {mags.map((r) => (
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
              <td>{layer.boundingBox.topLeft[0]}</td>
              <td>{layer.boundingBox.topLeft[1]}</td>
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
    );
  }, [layer, dataset]);

  return (
    <FastTooltip dynamicRenderer={renderTooltipContent} placement="left">
      <InfoCircleOutlined className="icon-margin-right" />
    </FastTooltip>
  );
}

class DatasetSettings extends React.PureComponent<DatasetSettingsProps, State> {
  onChangeUser: Record<keyof UserConfiguration, (...args: Array<any>) => any>;
  state: State = {
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
      <FastTooltip title={tooltipText}>
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
      </FastTooltip>
    );
  };

  getReloadDataButton = (
    layerName: string,
    isHistogramAvailable: boolean,
    maybeFallbackLayerName: string | null,
  ) => {
    const tooltipText = "Use this when the data on the server changed.";
    return (
      <FastTooltip title={tooltipText}>
        <div
          onClick={() =>
            this.reloadLayerData(layerName, isHistogramAvailable, maybeFallbackLayerName)
          }
        >
          <ReloadOutlined className="icon-margin-right" />
          Reload data from server
        </div>
      </FastTooltip>
    );
  };

  getEditMinMaxButton = (layerName: string, isInEditMode: boolean) => {
    const tooltipText = isInEditMode
      ? "Stop editing the possible range of the histogram."
      : "Manually set the possible range of the histogram.";
    return (
      <FastTooltip title={tooltipText}>
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
      </FastTooltip>
    );
  };

  getMergeWithFallbackLayerButton = (layer: APIDataLayer) => (
    <div onClick={() => this.setState({ layerToMergeWithFallback: layer })}>
      <i className="fas fa-object-ungroup icon-margin-right" />
      Merge this volume annotation with its fallback layer
    </div>
  );

  getDeleteAnnotationLayerButton = (
    readableName: string,
    type: AnnotationLayerType,
    tracingId: string,
  ) => (
    <div className="flex-item">
      <FastTooltip title="Delete this annotation layer.">
        <i
          onClick={() => this.deleteAnnotationLayerIfConfirmed(readableName, type, tracingId)}
          className="fas fa-trash icon-margin-right"
        />
      </FastTooltip>
    </div>
  );

  getDeleteAnnotationLayerDropdownOption = (
    readableName: string,
    type: AnnotationLayerType,
    tracingId: string,
    layer?: APIDataLayer,
  ) => (
    <div
      onClick={() => this.deleteAnnotationLayerIfConfirmed(readableName, type, tracingId, layer)}
    >
      <i className="fas fa-trash icon-margin-right" />
      Delete this annotation layer
    </div>
  );

  deleteAnnotationLayerIfConfirmed = async (
    readableAnnotationLayerName: string,
    type: AnnotationLayerType,
    tracingId: string,
    layer?: APIDataLayer,
  ) => {
    const fallbackLayerNote =
      layer && layer.category === "segmentation" && layer.fallbackLayer
        ? "Changes to the original segmentation layer will be discarded and the original state will be displayed again. "
        : "";
    const shouldDelete = await confirmAsync({
      title: `Deleting an annotation layer makes its content and history inaccessible. ${fallbackLayerNote}This cannot be undone. Are you sure you want to delete this layer?`,
      okText: `Yes, delete annotation layer “${readableAnnotationLayerName}”`,
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
    this.props.deleteAnnotationLayer(tracingId, type, readableAnnotationLayerName);
    await Model.ensureSavedState();
    location.reload();
  };

  getClipButton = (layerName: string, isInEditMode: boolean) => {
    const editModeAddendum = isInEditMode
      ? "In Edit Mode, the histogram's range will be adjusted, too."
      : "";
    const tooltipText = `Automatically clip the histogram to enhance contrast. ${editModeAddendum}`;
    return (
      <FastTooltip title={tooltipText}>
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
      </FastTooltip>
    );
  };

  getComputeSegmentIndexFileButton = (layerName: string, isSegmentation: boolean) => {
    if (!(this.props.isSuperUser && isSegmentation)) return <></>;

    const triggerComputeSegmentIndexFileJob = async () => {
      await startComputeSegmentIndexFileJob(this.props.dataset.id, layerName);
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

  getEnableDisableLayerSwitch = (isDisabled: boolean, onChange: SwitchChangeEventHandler) => (
    <FastTooltip title={isDisabled ? "Show" : "Hide"} placement="top">
      {/* This div is necessary for the tooltip to be displayed */}
      <div
        style={{
          display: "inline-block",
          marginRight: 8,
        }}
      >
        <Switch size="small" onChange={onChange} checked={!isDisabled} />
      </div>
    </FastTooltip>
  );

  getHistogram = (layerName: string, layer: DatasetLayerConfiguration) => {
    const { intensityRange, min, max, isInEditMode } = layer;
    if (!intensityRange) {
      return null;
    }
    const defaultIntensityRange = getDefaultValueRangeOfLayer(this.props.dataset, layerName);
    const histograms = this.props.histogramData?.[layerName];
    const elementClass = getElementClass(this.props.dataset, layerName);

    return (
      <Histogram
        supportFractions={elementClass === "float" || elementClass === "double"}
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
    layerSettings: DatasetLayerConfiguration,
    isHistogramAvailable: boolean,
    hasLessThanTwoColorLayers: boolean = true,
  ) => {
    const { annotation, dataset, isAdminOrManager } = this.props;
    const { intensityRange } = layerSettings;
    const layer = getLayerByName(dataset, layerName);
    const isSegmentation = layer.category === "segmentation";
    const layerType =
      layer.category === "segmentation" ? AnnotationLayerEnum.Volume : AnnotationLayerEnum.Skeleton;
    const canBeMadeEditable =
      isSegmentation && layer.tracingId == null && this.props.controlMode === "TRACE";
    const isVolumeTracing = isSegmentation ? layer.tracingId != null : false;
    const isAnnotationLayer = isSegmentation && layer.tracingId != null;
    const isOnlyAnnotationLayer =
      isAnnotationLayer && annotation && annotation.annotationLayers.length === 1;
    const maybeTracingId = isSegmentation ? layer.tracingId : null;
    const maybeVolumeTracing =
      maybeTracingId != null ? getVolumeTracingById(annotation, maybeTracingId) : null;
    const maybeFallbackLayer =
      maybeVolumeTracing?.fallbackLayer != null ? maybeVolumeTracing.fallbackLayer : null;

    const setSingleLayerVisibility = (isVisible: boolean) => {
      this.props.onChangeLayer(layerName, "isDisabled", !isVisible);
    };

    const onChange = (
      value: boolean,
      event: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>,
    ) => {
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
    const volumeDescriptor =
      "tracingId" in layer && layer.tracingId != null
        ? getVolumeDescriptorById(annotation, layer.tracingId)
        : null;
    const readableName =
      "tracingId" in layer && layer.tracingId != null
        ? getReadableNameByVolumeTracingId(annotation, layer.tracingId)
        : layerName;
    const allReadableLayerNames = getAllReadableLayerNames(dataset, annotation);
    const readableLayerNameValidationResult = validateReadableLayerName(
      readableName,
      allReadableLayerNames,
      readableName,
    );
    const possibleItems: MenuProps["items"] = [
      isVolumeTracing && !isDisabled && maybeFallbackLayer != null && isAdminOrManager
        ? {
            label: this.getMergeWithFallbackLayerButton(layer),
            key: "mergeWithFallbackLayerButton",
          }
        : null,
      this.props.dataset.isEditable
        ? {
            label: this.getReloadDataButton(layerName, isHistogramAvailable, maybeFallbackLayer),
            key: "reloadDataButton",
          }
        : null,
      {
        label: this.getFindDataButton(layerName, isDisabled, isColorLayer, maybeVolumeTracing),
        key: "findDataButton",
      },
      isAnnotationLayer && !isOnlyAnnotationLayer
        ? {
            label: (
              <div className="flex-item">
                {this.getDeleteAnnotationLayerDropdownOption(
                  readableName,
                  layerType,
                  layer.tracingId,
                  layer,
                )}
              </div>
            ),
            key: "deleteAnnotationLayer",
          }
        : null,
      !isDisabled
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
    const dragHandle = isColorLayer ? (
      hasLessThanTwoColorLayers ? (
        <DummyDragHandle tooltipTitle="Order is only changeable with more than one color layer." />
      ) : (
        <DragHandle id={layerName} />
      )
    ) : (
      <DummyDragHandle tooltipTitle="Layer not movable: Volume layers are always rendered on top." />
    );

    return (
      <div className="flex-container">
        {dragHandle}
        {this.getEnableDisableLayerSwitch(isDisabled, onChange)}
        <div
          className="flex-item"
          style={{
            fontWeight: 700,
            paddingRight: 5,
          }}
        >
          {volumeDescriptor != null ? (
            <FastTooltip
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
            </FastTooltip>
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
            <LayerInfoIconWithTooltip layer={layer} dataset={this.props.dataset} />
            {canBeMadeEditable ? (
              <FastTooltip
                title="Make this segmentation editable by adding a Volume Annotation Layer."
                placement="left"
              >
                <HoverIconButton
                  icon={<LockOutlined className="icon-margin-right" />}
                  hoveredIcon={<UnlockOutlined className="icon-margin-right" />}
                  onClick={() => {
                    this.setState({
                      isAddVolumeLayerModalVisible: true,
                      segmentationLayerWasPreselected: true,
                      preselectedSegmentationLayerName: layer.name,
                    });
                  }}
                />
              </FastTooltip>
            ) : null}
          </div>
          <TransformationIcon layer={layer} />
          <div className="flex-item">
            {isVolumeTracing ? (
              <FastTooltip
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
              </FastTooltip>
            ) : null}
          </div>
          <div className="flex-item">
            {intensityRange != null && intensityRange[0] === intensityRange[1] && !isDisabled ? (
              <FastTooltip
                title={`No data is being rendered for this layer as the minimum and maximum of the range have the same values.
            If you want to hide this layer, you can also disable it with the switch on the left.`}
              >
                <WarningOutlined
                  style={{
                    color: "var(--ant-color-warning)",
                  }}
                />
              </FastTooltip>
            ) : null}
            {isColorLayer ? null : this.getOptionalDownsampleVolumeIcon(maybeVolumeTracing)}
          </div>
        </div>
        <div className="flex-container" style={{ cursor: "pointer" }}>
          <div className="flex-item">
            <Dropdown menu={{ items }} trigger={["hover"]} placement="bottomRight">
              <EllipsisOutlined />
            </Dropdown>
          </div>
        </div>
      </div>
    );
  };

  getColorLayerSpecificSettings = (
    layerConfiguration: DatasetLayerConfiguration,
    layerName: string,
  ) => {
    const defaultSettings = getDefaultLayerViewConfiguration();
    return (
      <div>
        <LogSliderSetting
          label={
            <FastTooltip title={layerViewConfigurationTooltips.gammaCorrectionValue}>
              {layerViewConfigurations.gammaCorrectionValue}
            </FastTooltip>
          }
          min={0.01}
          max={10}
          roundTo={3}
          value={layerConfiguration.gammaCorrectionValue}
          onChange={_.partial(this.props.onChangeLayer, layerName, "gammaCorrectionValue")}
          defaultValue={defaultSettings.gammaCorrectionValue}
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
            <FastTooltip title="Invert the color of this layer.">
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
            </FastTooltip>
          </Col>
        </Row>
      </div>
    );
  };

  getSegmentationSpecificSettings = (layerName: string) => {
    const segmentationOpacitySetting = (
      <NumberSliderSetting
        label={settings.segmentationPatternOpacity}
        min={0}
        max={100}
        step={1}
        value={this.props.datasetConfiguration.segmentationPatternOpacity}
        onChange={_.partial(this.props.onChange, "segmentationPatternOpacity")}
        defaultValue={defaultDatasetViewConfiguration.segmentationPatternOpacity}
      />
    );

    return (
      <div>
        {segmentationOpacitySetting}
        <HideUnregisteredSegmentsSwitch layerName={layerName} />
        <MappingSettingsView layerName={layerName} />
      </div>
    );
  };

  LayerSettings = ({
    layerName,
    layerConfiguration,
    isColorLayer,
    isLastLayer,
    hasLessThanTwoColorLayers = true,
  }: {
    layerName: string;
    layerConfiguration: DatasetLayerConfiguration | null | undefined;
    isColorLayer: boolean;
    isLastLayer: boolean;
    hasLessThanTwoColorLayers?: boolean;
  }) => {
    const { setNodeRef, transform, transition, isDragging } = useSortable({ id: layerName });

    // Ensure that every layer needs a layer configuration and that color layers have a color layer.
    if (!layerConfiguration || (isColorLayer && !layerConfiguration.color)) {
      return null;
    }
    const elementClass = getElementClass(this.props.dataset, layerName);
    const { isDisabled, isInEditMode } = layerConfiguration;
    const betweenLayersMarginBottom = isLastLayer ? {} : { marginBottom: 30 };

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      zIndex: isDragging ? "100" : "auto",
      opacity: isDragging ? 0.3 : 1,
      marginBottom: isLastLayer ? 30 : 0,
    };

    const opacityLabel =
      layerConfiguration.alpha === 0 ? (
        <FastTooltip title="The current opacity is zero">
          Opacity <WarningOutlined style={{ color: "orange" }} />
        </FastTooltip>
      ) : (
        "Opacity"
      );

    const isHistogramAvailable = isHistogramSupported(elementClass) && isColorLayer;
    const layerSpecificDefaults = getSpecificDefaultsForLayer(
      this.props.dataset,
      layerName,
      isColorLayer,
    );

    return (
      <div key={layerName} style={style} ref={setNodeRef}>
        {this.getLayerSettingsHeader(
          isDisabled,
          isColorLayer,
          isInEditMode,
          layerName,
          layerConfiguration,
          isHistogramAvailable,
          hasLessThanTwoColorLayers,
        )}
        {isDisabled ? null : (
          <div
            style={{
              ...betweenLayersMarginBottom,
              marginLeft: 10,
            }}
          >
            {isHistogramAvailable && this.getHistogram(layerName, layerConfiguration)}
            <NumberSliderSetting
              label={opacityLabel}
              min={0}
              max={100}
              value={layerConfiguration.alpha}
              onChange={_.partial(this.props.onChangeLayer, layerName, "alpha")}
              defaultValue={layerSpecificDefaults.alpha}
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
    const { tracingStore } = Store.getState().annotation;
    const { dataset } = this.props;
    let foundPosition;
    let foundMag;

    if (volume && !isDataLayer) {
      const { position, mag } = await findDataPositionForVolumeTracing(
        tracingStore.url,
        volume.tracingId,
      );

      if ((!position || !mag) && volume.fallbackLayer) {
        await this.handleFindData(volume.fallbackLayer, true, volume);
        return;
      }

      foundPosition = position;
      foundMag = mag;
    } else {
      const { position, mag } = await findDataPositionForLayer(
        dataset.dataStore.url,
        dataset,
        layerName,
      );
      foundPosition = position;
      foundMag = mag;
    }

    if (foundPosition && foundMag) {
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
    const zoomValue = this.props.onZoomToMag(layerName, foundMag);
    Toast.success(
      `Jumping to position ${foundPosition
        .map((el) => Math.floor(el))
        .join(", ")} and zooming to ${zoomValue.toFixed(2)}`,
    );
  };

  reloadLayerData = async (
    layerName: string,
    isHistogramAvailable: boolean,
    maybeFallbackLayerName: string | null,
  ): Promise<void> => {
    await clearCache(this.props.dataset, maybeFallbackLayerName ?? layerName);
    if (isHistogramAvailable) this.props.reloadHistogram(layerName);
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
    const volumeTargetMag =
      fallbackLayerInfo != null
        ? fallbackLayerInfo.resolutions
        : // This is only a heuristic. At some point, user configuration
          // might make sense here.
          getWidestMags(this.props.dataset);

    const getMaxDim = (mag: Vector3) => Math.max(...mag);

    const volumeTracingMags = segmentationLayer.mags;

    const sourceMag = _.minBy(volumeTracingMags, getMaxDim);
    if (sourceMag === undefined) {
      return [];
    }

    const possibleMags = volumeTargetMag.filter((mag) => getMaxDim(mag) >= getMaxDim(sourceMag));

    const magsToDownsample = _.differenceWith(possibleMags, volumeTracingMags, _.isEqual);

    return magsToDownsample;
  };

  getOptionalDownsampleVolumeIcon = (volumeTracing: VolumeTracing | null | undefined) => {
    if (!volumeTracing) {
      return null;
    }

    const magsToDownsample = this.getVolumeMagsToDownsample(volumeTracing);
    const hasExtensiveMags = magsToDownsample.length === 0;

    if (hasExtensiveMags) {
      return null;
    }

    return (
      <FastTooltip title="This volume tracing does not have data at all magnifications.">
        <WarningOutlined
          style={{
            color: "var(--ant-color-warning)",
          }}
        />
      </FastTooltip>
    );
  };

  getSkeletonLayer = () => {
    const { controlMode, annotation, onChangeRadius, userConfiguration, onChangeShowSkeletons } =
      this.props;
    const isPublicViewMode = controlMode === ControlModeEnum.VIEW;

    if (isPublicViewMode || annotation.skeleton == null) {
      return null;
    }

    const readableName = "Skeleton";
    const skeletonTracing = enforceSkeletonTracing(annotation);
    const isOnlyAnnotationLayer = annotation.annotationLayers.length === 1;
    const { showSkeletons, tracingId } = skeletonTracing;
    const activeNodeRadius = getActiveNode(skeletonTracing)?.radius ?? 0;
    return (
      <React.Fragment>
        <div
          className="flex-container"
          style={{
            paddingRight: 1,
          }}
        >
          <DummyDragHandle tooltipTitle="Layer not movable: Skeleton layers are always rendered on top." />
          <div
            className="flex-item"
            style={{
              marginRight: 8,
            }}
          >
            <FastTooltip
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
            </FastTooltip>
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
            <TransformationIcon layer={{ category: "skeleton", name: tracingId }} />
            {!isOnlyAnnotationLayer
              ? this.getDeleteAnnotationLayerButton(
                  readableName,
                  AnnotationLayerEnum.Skeleton,
                  annotation.skeleton.tracingId,
                )
              : null}
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
              defaultValue={Constants.DEFAULT_NODE_RADIUS}
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
              defaultValue={defaultState.userConfiguration.particleSize}
            />
            {this.props.isArbitraryMode ? (
              <NumberSliderSetting
                label={settings.clippingDistanceArbitrary}
                min={userSettings.clippingDistanceArbitrary.minimum}
                max={userSettings.clippingDistanceArbitrary.maximum}
                value={userConfiguration.clippingDistanceArbitrary}
                onChange={this.onChangeUser.clippingDistanceArbitrary}
                defaultValue={defaultState.userConfiguration.clippingDistanceArbitrary}
              />
            ) : (
              <LogSliderSetting
                label={settings.clippingDistance}
                roundTo={3}
                min={userSettings.clippingDistance.minimum}
                max={userSettings.clippingDistance.maximum}
                value={userConfiguration.clippingDistance}
                onChange={this.onChangeUser.clippingDistance}
                defaultValue={defaultState.userConfiguration.clippingDistance}
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
    this.props.addSkeletonLayerToAnnotation();
    await Model.ensureSavedState();
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
          This includes all color and segmentation layer settings, currently active mappings (even
          those of disabled layers), as well as these additional settings:
          <br />
          <br />
          {dataSource.map((field, index) => {
            let delimiter = index === dataSource.length - 1 ? "" : ", ";
            delimiter = index === dataSource.length - 2 ? " and " : delimiter;
            return field.description ? (
              <>
                {field.name}{" "}
                <FastTooltip title={field.description} key={`tooltip_${field.name}`}>
                  <InfoCircleOutlined style={{ color: "gray", marginRight: 0 }} />
                </FastTooltip>
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
          const { flycam, temporaryConfiguration } = Store.getState();
          const position = V3.floor(getPosition(flycam));
          const zoom = flycam.zoomStep;
          const { activeMappingByLayer } = temporaryConfiguration;
          const completeDatasetConfiguration = Object.assign({}, datasetConfiguration, {
            position,
            zoom,
          });
          const updatedLayers = {
            ...completeDatasetConfiguration.layers,
          } as DatasetConfiguration["layers"];
          Object.keys(activeMappingByLayer).forEach((layerName) => {
            const mappingInfo = activeMappingByLayer[layerName];
            if (
              mappingInfo.mappingStatus === MappingStatusEnum.ENABLED &&
              mappingInfo.mappingName != null
            ) {
              updatedLayers[layerName] = {
                ...updatedLayers[layerName],
                mapping: {
                  name: mappingInfo.mappingName,
                  type: mappingInfo.mappingType,
                },
              };
            } else {
              updatedLayers[layerName] = {
                ...updatedLayers[layerName],
                mapping: null,
              };
            }
          });
          const updatedConfiguration = {
            ...completeDatasetConfiguration,
            layers: updatedLayers,
          };
          await updateDatasetDefaultConfiguration(dataset.id, updatedConfiguration);
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

  onSortLayerSettingsEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    // Fix for having a grabbing cursor during dragging from https://github.com/clauderic/react-sortable-hoc/issues/328#issuecomment-1005835670.
    document.body.classList.remove("is-dragging");
    const { colorLayerOrder } = this.props.datasetConfiguration;

    if (over) {
      const oldIndex = colorLayerOrder.indexOf(active.id as string);
      const newIndex = colorLayerOrder.indexOf(over.id as string);
      const movedElement = colorLayerOrder[oldIndex];

      const newIndexClipped = Math.min(newIndex, colorLayerOrder.length - 1);
      const newLayerOrder = update(colorLayerOrder, {
        $splice: [
          [oldIndex, 1],
          [newIndexClipped, 0, movedElement],
        ],
      });
      this.props.onChange("colorLayerOrder", newLayerOrder);
    }
  };

  render() {
    const { layers, colorLayerOrder } = this.props.datasetConfiguration;
    const LayerSettings = this.LayerSettings;

    const segmentationLayerNames = Object.keys(layers).filter(
      (layerName) => !getIsColorLayer(this.props.dataset, layerName),
    );
    const hasLessThanTwoColorLayers = colorLayerOrder.length < 2;
    const colorLayerSettings = colorLayerOrder.map((layerName, index) => {
      return (
        <LayerSettings
          key={layerName}
          layerName={layerName}
          layerConfiguration={layers[layerName]}
          isColorLayer
          isLastLayer={index === colorLayerOrder.length - 1}
          hasLessThanTwoColorLayers={hasLessThanTwoColorLayers}
        />
      );
    });
    const segmentationLayerSettings = segmentationLayerNames.map((layerName, index) => {
      return (
        <LayerSettings
          key={layerName}
          layerName={layerName}
          isLastLayer={index === segmentationLayerNames.length - 1}
          layerConfiguration={layers[layerName]}
          isColorLayer={false}
        />
      );
    });

    const state = Store.getState();
    const canBeMadeHybrid =
      this.props.annotation.skeleton === null &&
      this.props.annotation.annotationType === APIAnnotationTypeEnum.Explorational &&
      state.task === null;

    return (
      <div className="tracing-settings-menu">
        <DndContext
          onDragEnd={this.onSortLayerSettingsEnd}
          onDragStart={() =>
            colorLayerOrder.length > 1 && document.body.classList.add("is-dragging")
          }
        >
          <SortableContext
            items={colorLayerOrder.map((layerName) => layerName)}
            strategy={verticalListSortingStrategy}
          >
            {colorLayerSettings}
          </SortableContext>
        </DndContext>

        {segmentationLayerSettings}
        {this.getSkeletonLayer()}

        {this.props.annotation.restrictions.allowUpdate &&
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

        {this.props.annotation.restrictions.allowUpdate && canBeMadeHybrid ? (
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
            <FastTooltip title="Save the current view configuration as default for all users.">
              <Button onClick={this.saveViewConfigurationAsDefault}>
                <SaveOutlined />
                Save View Configuration as Default
              </Button>
            </FastTooltip>
          </Row>
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
            annotation={this.props.annotation}
            preselectedLayerName={this.state.preselectedSegmentationLayerName}
            disableLayerSelection={this.state.segmentationLayerWasPreselected}
          />
        ) : null}
      </div>
    );
  }
}

const mapStateToProps = (state: WebknossosState) => ({
  userConfiguration: state.userConfiguration,
  datasetConfiguration: state.datasetConfiguration,
  histogramData: state.temporaryConfiguration.histogramData,
  dataset: state.dataset,
  annotation: state.annotation,
  task: state.task,
  controlMode: state.temporaryConfiguration.controlMode,
  isArbitraryMode: Constants.MODES_ARBITRARY.includes(state.temporaryConfiguration.viewMode),
  isAdminOrDatasetManager:
    state.activeUser != null ? Utils.isUserAdminOrDatasetManager(state.activeUser) : false,
  isAdminOrManager: state.activeUser != null ? Utils.isUserAdminOrManager(state.activeUser) : false,
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

  onZoomToMag(layerName: string, mag: Vector3) {
    const targetZoomValue = getMaxZoomValueForMag(Store.getState(), layerName, mag);
    dispatch(setZoomStepAction(targetZoomValue));
    return targetZoomValue;
  },

  onEditAnnotationLayer(tracingId: string, layerProperties: EditableLayerProperties) {
    dispatch(editAnnotationLayerAction(tracingId, layerProperties));
  },

  reloadHistogram(layerName: string) {
    dispatch(reloadHistogramAction(layerName));
  },

  addSkeletonLayerToAnnotation() {
    dispatch(
      pushSaveQueueTransactionIsolated(
        addLayerToAnnotation({
          typ: "Skeleton",
          name: "skeleton",
          fallbackLayerName: undefined,
        }),
      ),
    );
  },

  deleteAnnotationLayer(tracingId: string, type: AnnotationLayerType, layerName: string) {
    dispatch(pushSaveQueueTransaction([deleteAnnotationLayer(tracingId, layerName, type)]));
  },
});

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(DatasetSettings);
