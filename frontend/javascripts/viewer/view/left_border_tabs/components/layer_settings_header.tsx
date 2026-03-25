import Icon, {
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  LockOutlined,
  MergeCellsOutlined,
  ReloadOutlined,
  ScanOutlined,
  UnlockOutlined,
  VerticalAlignMiddleOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import BrushIcon from "@images/icons/icon-brush.svg?react";
import {
  clearCache,
  findDataPositionForLayer,
  findDataPositionForVolumeTracing,
  startComputeSegmentIndexFileJob,
} from "admin/rest_api";
import { Dropdown, Flex, type MenuProps, Switch } from "antd";
import type { ItemType } from "antd/es/menu/interface";
import type { SwitchChangeEventHandler } from "antd/es/switch";
import FastTooltip from "components/fast_tooltip";
import { HoverIconButton } from "components/hover_icon_button";
import { confirmAsync } from "dashboard/dataset/helper_components";
import { M4x4, V3 } from "libs/mjs";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { isUserAdminOrManager } from "libs/utils";
import differenceWith from "lodash-es/differenceWith";
import isEqual from "lodash-es/isEqual";
import minBy from "lodash-es/minBy";
import React, { useCallback } from "react";
import { useDispatch } from "react-redux";
import {
  AnnotationLayerEnum,
  type AnnotationLayerType,
  type APIDataLayer,
  APIJobCommand,
} from "types/api_types";
import type { Vector3 } from "viewer/constants";
import {
  getLayerBoundingBox,
  getLayerByName,
  getWidestMags,
} from "viewer/model/accessors/dataset_accessor";
import { getTransformsForLayerOrNull } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { getMaxZoomValueForMag } from "viewer/model/accessors/flycam_accessor";
import {
  getAllReadableLayerNames,
  getReadableNameByVolumeTracingId,
  getVolumeDescriptorById,
  getVolumeTracingById,
} from "viewer/model/accessors/volumetracing_accessor";
import { editAnnotationLayerAction } from "viewer/model/actions/annotation_actions";
import { setPositionAction, setZoomStepAction } from "viewer/model/actions/flycam_actions";
import { pushSaveQueueTransaction } from "viewer/model/actions/save_actions";
import {
  dispatchClipHistogramAsync,
  reloadHistogramAction,
  updateLayerSettingAction,
} from "viewer/model/actions/settings_actions";
import { deleteAnnotationLayer } from "viewer/model/sagas/volume/update_actions";
import { api, Model } from "viewer/singletons";
import type { DatasetLayerConfiguration, VolumeTracing } from "viewer/store";
import Store from "viewer/store";
import ButtonComponent from "viewer/view/components/button_component";
import EditableTextLabel from "viewer/view/components/editable_text_label";
import { validateReadableLayerName } from "../modals/add_volume_layer_modal";
import { DragHandle, DummyDragHandle } from "./drag_handle";
import LayerInfoIconWithTooltip from "./layer_info_icon_with_tooltip";
import LayerTransformationIcon from "./layer_transformation_icon";

function EnableDisableLayerSwitch({
  isDisabled,
  onChange,
}: {
  isDisabled: boolean;
  onChange: SwitchChangeEventHandler;
}) {
  return (
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
}

export default function LayerSettingsHeader({
  layerName,
  layerSettings,
  isColorLayer,
  isDisabled,
  isInEditMode,
  isHistogramAvailable,
  hasLessThanTwoColorLayers = true,
  onShowAddVolumeLayerModal,
  onSetLayerToMergeWithFallback,
}: {
  layerName: string;
  layerSettings: DatasetLayerConfiguration;
  isColorLayer: boolean;
  isDisabled: boolean;
  isInEditMode: boolean;
  isHistogramAvailable: boolean;
  hasLessThanTwoColorLayers?: boolean;
  onShowAddVolumeLayerModal: (preselectedSegmentationLayerName: string) => void;
  onSetLayerToMergeWithFallback: (layer: APIDataLayer) => void;
}) {
  const dispatch = useDispatch();
  const dataset = useWkSelector((state) => state.dataset);
  const annotation = useWkSelector((state) => state.annotation);
  const controlMode = useWkSelector((state) => state.temporaryConfiguration.controlMode);
  const isAdminOrManager = useWkSelector((state) =>
    state.activeUser != null ? isUserAdminOrManager(state.activeUser) : false,
  );
  const isSuperUser = useWkSelector((state) => state.activeUser?.isSuperUser || false);
  const histogramData = useWkSelector((state) => state.temporaryConfiguration.histogramData);
  const datasetConfiguration = useWkSelector((state) => state.datasetConfiguration);
  const task = useWkSelector((state) => state.task);

  const { intensityRange } = layerSettings;
  const layer = getLayerByName(dataset, layerName);
  const isSegmentation = layer.category === "segmentation";
  const layerType =
    layer.category === "segmentation" ? AnnotationLayerEnum.Volume : AnnotationLayerEnum.Skeleton;
  const canBeMadeEditable = isSegmentation && layer.tracingId == null && controlMode === "TRACE";
  const isVolumeTracing = isSegmentation ? layer.tracingId != null : false;
  const isAnnotationLayer = isSegmentation && layer.tracingId != null;
  const isOnlyAnnotationLayer =
    isAnnotationLayer && annotation && annotation.annotationLayers.length === 1;
  const maybeTracingId = isSegmentation ? layer.tracingId : null;
  const maybeVolumeTracing =
    maybeTracingId != null ? getVolumeTracingById(annotation, maybeTracingId) : null;
  const maybeFallbackLayer =
    maybeVolumeTracing?.fallbackLayer != null ? maybeVolumeTracing.fallbackLayer : null;

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
  const hasHistogram = histogramData[layerName] != null;

  // --- Helper functions ---

  const onChangeLayer = useCallback(
    (propertyName: keyof DatasetLayerConfiguration, value: any) => {
      dispatch(updateLayerSettingAction(layerName, propertyName, value));
    },
    [dispatch, layerName],
  );

  const handleFindData = useCallback(
    async (
      targetLayerName: string,
      isDataLayer: boolean,
      volume: VolumeTracing | null | undefined,
    ) => {
      const { tracingStore } = Store.getState().annotation;
      let foundPosition;
      let foundMag;

      if (volume && !isDataLayer) {
        const { position, mag } = await findDataPositionForVolumeTracing(
          tracingStore.url,
          volume.tracingId,
        );

        if ((!position || !mag) && volume.fallbackLayer) {
          await handleFindData(volume.fallbackLayer, true, volume);
          return;
        }

        foundPosition = position;
        foundMag = mag;
      } else {
        const { position, mag } = await findDataPositionForLayer(
          dataset.dataStore.url,
          dataset,
          targetLayerName,
        );
        foundPosition = position;
        foundMag = mag;
      }

      if (foundPosition && foundMag) {
        const foundLayer = getLayerByName(dataset, targetLayerName, true);
        const transformMatrix = getTransformsForLayerOrNull(
          dataset,
          foundLayer,
          Store.getState().datasetConfiguration.nativelyRenderedLayerName,
        )?.affineMatrix;
        if (transformMatrix) {
          const matrix = M4x4.transpose(transformMatrix);
          V3.mul4x4(matrix, foundPosition, foundPosition);
        }
      } else {
        const centerPosition = getLayerBoundingBox(dataset, targetLayerName).getCenter();
        Toast.warning(
          `Couldn't find data within layer "${targetLayerName}." Jumping to the center of the layer's bounding box.`,
        );
        dispatch(setPositionAction(centerPosition));
        return;
      }

      dispatch(setPositionAction(foundPosition));
      const targetZoomValue = getMaxZoomValueForMag(Store.getState(), targetLayerName, foundMag);
      dispatch(setZoomStepAction(targetZoomValue));
      Toast.success(
        `Jumping to position ${foundPosition
          .map((el: number) => Math.floor(el))
          .join(", ")} and zooming to ${targetZoomValue.toFixed(2)}`,
      );
    },
    [dataset, dispatch],
  );

  const reloadLayerData = useCallback(
    async (
      targetLayerName: string,
      isHistAvailable: boolean,
      maybeFallbackLayerName: string | null,
    ): Promise<void> => {
      await clearCache(dataset, maybeFallbackLayerName ?? targetLayerName);
      if (isHistAvailable) dispatch(reloadHistogramAction(targetLayerName));
      await api.data.reloadBuckets(targetLayerName);
      Toast.success(`Successfully reloaded data of layer ${targetLayerName}.`);
    },
    [dataset, dispatch],
  );

  const deleteAnnotationLayerIfConfirmed = useCallback(
    async (
      readableAnnotationLayerName: string,
      type: AnnotationLayerType,
      tracingId: string,
      targetLayer?: APIDataLayer,
    ) => {
      const fallbackLayerNote =
        targetLayer && targetLayer.category === "segmentation" && targetLayer.fallbackLayer
          ? "Changes to the original segmentation layer will be discarded and the original state will be displayed again. "
          : "";
      const shouldDelete = await confirmAsync({
        title: `Deleting an annotation layer makes its content and history inaccessible. ${fallbackLayerNote}This cannot be undone. Are you sure you want to delete this layer?`,
        okText: `Yes, delete annotation layer "${readableAnnotationLayerName}"`,
        cancelText: "Cancel",
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
      dispatch(
        pushSaveQueueTransaction([
          deleteAnnotationLayer(tracingId, readableAnnotationLayerName, type),
        ]),
      );
      await Model.ensureSavedState();
      location.reload();
    },
    [dispatch],
  );

  const getVolumeMagsToDownsample = (
    volumeTracing: VolumeTracing | null | undefined,
  ): Array<Vector3> => {
    if (task != null) return [];
    if (volumeTracing == null) return [];

    const segmentationLayer = Model.getSegmentationTracingLayer(volumeTracing.tracingId);
    const { fallbackLayerInfo } = segmentationLayer;
    const volumeTargetMags =
      fallbackLayerInfo != null
        ? fallbackLayerInfo.mags.map(({ mag }: { mag: Vector3 }) => mag)
        : getWidestMags(dataset);

    const getMaxDim = (mag: Vector3) => Math.max(...mag);
    const volumeTracingMags = segmentationLayer.mags.map((magObj: { mag: Vector3 }) => magObj.mag);
    const sourceMag = minBy(volumeTracingMags, getMaxDim);
    if (sourceMag === undefined) return [];

    const possibleMags = volumeTargetMags.filter(
      (mag: Vector3) => getMaxDim(mag) >= getMaxDim(sourceMag),
    );
    return differenceWith(possibleMags, volumeTracingMags, isEqual);
  };

  const getOptionalDownsampleVolumeIcon = (volumeTracing: VolumeTracing | null | undefined) => {
    if (!volumeTracing) return null;

    const magsToDownsample = getVolumeMagsToDownsample(volumeTracing);
    if (magsToDownsample.length === 0) return null;

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

  // --- Menu item builders ---

  const getFindDataItem = (): ItemType => {
    let tooltipText = isDisabled
      ? "You cannot search for data when the layer is disabled."
      : "If you are having trouble finding your data, WEBKNOSSOS can try to find a position which contains data.";

    if (!isColorLayer && maybeVolumeTracing && maybeVolumeTracing.fallbackLayer) {
      tooltipText =
        "WEBKNOSSOS will try to find data in your volume tracing first and in the fallback layer afterwards.";
    }

    return {
      key: "findDataButton",
      icon: <ScanOutlined />,
      disabled: isDisabled,
      label: (
        <FastTooltip title={tooltipText}>
          <span>Jump to data</span>
        </FastTooltip>
      ),
      onClick: () => handleFindData(layerName, isColorLayer, maybeVolumeTracing),
    };
  };

  const getReloadDataItem = (): ItemType => {
    const tooltipText = "Use this when the data on the server changed.";
    return {
      key: "reloadDataButton",
      icon: <ReloadOutlined />,
      label: (
        <FastTooltip title={tooltipText}>
          <span>Reload data from server</span>
        </FastTooltip>
      ),
      onClick: () => reloadLayerData(layerName, isHistogramAvailable, maybeFallbackLayer),
    };
  };

  const getEditMinMaxItem = (): ItemType => {
    const tooltipText = isInEditMode
      ? "Stop editing the possible range of the histogram."
      : "Manually set the possible range of the histogram.";
    return {
      key: "editMinMax",
      icon: (
        <EditOutlined
          style={{
            color: isInEditMode ? "var(--ant-color-primary)" : undefined,
          }}
        />
      ),
      label: (
        <FastTooltip title={tooltipText}>
          <span>{isInEditMode ? "Stop editing" : "Edit"} histogram range</span>
        </FastTooltip>
      ),
      onClick: () => onChangeLayer("isInEditMode", !isInEditMode),
    };
  };

  const getMergeWithFallbackLayerItem = (): ItemType => ({
    key: "mergeWithFallbackLayerButton",
    icon: <MergeCellsOutlined />,
    label: "Merge this volume annotation with its fallback layer",
    onClick: () => onSetLayerToMergeWithFallback(layer),
  });

  const getDeleteAnnotationLayerItem = (): ItemType => ({
    key: "deleteAnnotationLayer",
    icon: <DeleteOutlined />,
    label: "Delete this annotation layer",
    onClick: () => {
      const tracingId = "tracingId" in layer ? layer.tracingId : null;
      if (tracingId != null) {
        deleteAnnotationLayerIfConfirmed(readableName, layerType, tracingId, layer);
      }
    },
  });

  const getClipItem = (): ItemType => {
    const editModeAddendum = isInEditMode
      ? "In Edit Mode, the histogram's range will be adjusted, too."
      : "";
    const tooltipText = `Automatically clip the histogram to enhance contrast. ${editModeAddendum}`;
    return {
      key: "clipButton",
      icon: (
        <VerticalAlignMiddleOutlined
          style={{
            transform: "rotate(90deg)",
          }}
        />
      ),
      label: (
        <FastTooltip title={tooltipText}>
          <span>Clip histogram</span>
        </FastTooltip>
      ),
      onClick: () => dispatchClipHistogramAsync(layerName, isInEditMode, dispatch),
    };
  };

  const getComputeSegmentIndexFileItem = (): ItemType => {
    if (!(isSuperUser && isSegmentation)) return null;

    const triggerComputeSegmentIndexFileJob = async () => {
      await startComputeSegmentIndexFileJob(dataset.id, layerName);
      Toast.info(
        <React.Fragment>
          Started a job for computing a segment index file.
          <br />
          See{" "}
          <a target="_blank" href="/jobs" rel="noopener noreferrer">
            Processing Jobs
          </a>{" "}
          for an overview of running jobs.
        </React.Fragment>,
      );
    };

    return {
      key: "computeSegmentIndexFileButton",
      icon: <DatabaseOutlined />,
      label: "Compute a Segment Index file",
      onClick: triggerComputeSegmentIndexFileJob,
    };
  };

  // --- Visibility logic ---

  const setSingleLayerVisibility = useCallback(
    (isVisible: boolean) => {
      onChangeLayer("isDisabled", !isVisible);
    },
    [onChangeLayer],
  );

  const isLayerExclusivelyVisible = useCallback((): boolean => {
    const { layers } = datasetConfiguration;
    return Object.keys(layers).every((otherLayerName) => {
      const { isDisabled: otherIsDisabled } = layers[otherLayerName];
      return layerName === otherLayerName ? !otherIsDisabled : otherIsDisabled;
    });
  }, [datasetConfiguration, layerName]);

  const setVisibilityForAllLayers = useCallback(
    (isVisible: boolean) => {
      const { layers } = datasetConfiguration;
      Object.keys(layers).forEach((otherLayerName) => {
        dispatch(updateLayerSettingAction(otherLayerName, "isDisabled", !isVisible));
      });
    },
    [datasetConfiguration, dispatch],
  );

  const onChange = useCallback(
    (
      value: boolean,
      event: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>,
    ) => {
      if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
        setSingleLayerVisibility(value);
        return;
      }

      if (isLayerExclusivelyVisible()) {
        setVisibilityForAllLayers(true);
      } else {
        setVisibilityForAllLayers(false);
        setSingleLayerVisibility(true);
      }
    },
    [setSingleLayerVisibility, isLayerExclusivelyVisible, setVisibilityForAllLayers],
  );

  // --- Build menu items ---

  const possibleItems: MenuProps["items"] = [
    isVolumeTracing && !isDisabled && maybeFallbackLayer != null && isAdminOrManager
      ? getMergeWithFallbackLayerItem()
      : null,
    dataset.isEditable ? getReloadDataItem() : null,
    getFindDataItem(),
    isAnnotationLayer && !isOnlyAnnotationLayer ? getDeleteAnnotationLayerItem() : null,
    isHistogramAvailable && !isDisabled ? getEditMinMaxItem() : null,
    hasHistogram && !isDisabled ? getClipItem() : null,
    dataset.dataStore.jobsEnabled &&
    dataset.dataStore.jobsSupportedByAvailableWorkers.includes(
      APIJobCommand.COMPUTE_SEGMENT_INDEX_FILE,
    )
      ? getComputeSegmentIndexFileItem()
      : null,
  ];
  const items = possibleItems.filter((el) => el);

  // --- Drag handle ---

  const dragHandle = isColorLayer ? (
    hasLessThanTwoColorLayers ? (
      <DummyDragHandle tooltipTitle="Order is only changeable with more than one color layer." />
    ) : (
      <DragHandle id={layerName} />
    )
  ) : (
    <DummyDragHandle tooltipTitle="Layer not movable: Volume layers are always rendered on top." />
  );

  // --- Render ---

  return (
    <Flex align="center">
      {dragHandle}
      <EnableDisableLayerSwitch isDisabled={isDisabled} onChange={onChange} />
      <div
        style={{
          fontWeight: 700,
          paddingRight: 5,
          flexGrow: 1,
          wordBreak: "break-all",
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
                width={150}
                value={readableName}
                isInvalid={!readableLayerNameValidationResult.isValid}
                trimValue
                onChange={(newName) => {
                  dispatch(
                    editAnnotationLayerAction(volumeDescriptor.tracingId, {
                      name: newName,
                    }),
                  );
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
      <Flex
        style={{
          paddingRight: 1,
        }}
        align="center"
      >
        <LayerInfoIconWithTooltip layer={layer} dataset={dataset} />
        {canBeMadeEditable ? (
          <FastTooltip
            title="Make this segmentation editable by adding a Volume Annotation Layer."
            placement="left"
          >
            <HoverIconButton
              variant="text"
              color="default"
              size="small"
              icon={<LockOutlined />}
              hoveredIcon={<UnlockOutlined />}
              onClick={() => {
                onShowAddVolumeLayerModal(layer.name);
              }}
            />
          </FastTooltip>
        ) : null}
        <LayerTransformationIcon layer={layer} />
        {isVolumeTracing ? (
          <ButtonComponent
            variant="text"
            color="default"
            size="small"
            disabled
            title={`This layer is a volume annotation.${
              maybeFallbackLayer
                ? ` It is based on the dataset's original layer ${maybeFallbackLayer}`
                : ""
            }`}
            tooltipPlacement="left"
            icon={<Icon component={BrushIcon} />}
          />
        ) : null}
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
        {isColorLayer ? null : getOptionalDownsampleVolumeIcon(maybeVolumeTracing)}
        <Dropdown menu={{ items }} trigger={["hover"]} placement="bottomRight">
          <ButtonComponent
            variant="text"
            color="default"
            size="small"
            icon={<EllipsisOutlined rotate={90} />}
          />
        </Dropdown>
      </Flex>
    </Flex>
  );
}
