import { hasSegmentIndexInDataStore } from "admin/rest_api";
import { type MenuProps, Modal } from "antd";
import { waitForCondition } from "libs/utils";
import type { APIDataLayer, APIDataset } from "types/api_types";
import { MappingStatusEnum, type Vector3 } from "viewer/constants";
import { mayEditAnnotation } from "viewer/model/accessors/annotation_accessor";
import {
  getMappingInfo,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import {
  getEditableMappingForVolumeTracingId,
  getVolumeTracingById,
} from "viewer/model/accessors/volumetracing_accessor";
import { setMappingAction, setMappingEnabledAction } from "viewer/model/actions/settings_actions";
import type {
  ActiveMappingInfo,
  Segment,
  SegmentGroup,
  SegmentMap,
  StoreAnnotation,
  WebknossosState,
} from "viewer/store";
import Store from "viewer/store";
import {
  createGroupToSegmentsMap,
  getGroupByIdWithSubgroups,
  MISSING_GROUP_ID,
} from "../shared/tree_hierarchy_view_helpers";

const { confirm } = Modal;

export const stlMeshConstants = {
  meshMarker: [105, 115, 111],
  // ASCII codes for ISO
  segmentIdIndex: 3, // Write cell index after the meshMarker
};

export const formatMagWithLabel = (mag: Vector3, index: number) => {
  // index refers to the array of available mags. Thus, we can directly
  // use that index to pick an adequate label.
  const labels = ["Highest", "High", "Medium", "Low", "Very Low"];
  // Use "Very Low" for all low Mags which don't have extra labels
  const clampedIndex = Math.min(labels.length - 1, index);
  return `${labels[clampedIndex]} (Mag ${mag.join("-")})`;
};

export function getBaseSegmentationName(segmentationLayer: APIDataLayer) {
  return (
    ("fallbackLayer" in segmentationLayer ? segmentationLayer.fallbackLayer : null) ||
    segmentationLayer.name
  );
}

/*
 * Whether the segments (and segment groups) of the visible segmentation layer
 * may be edited. View-only segmentation layers (without a tracing) are not editable,
 * even if the annotation itself is.
 */
export function mayEditVisibleSegmentation(state: WebknossosState): boolean {
  // Editing requires an actually visible, tracing-backed segmentation layer.
  // A missing layer or a non-tracing (view-only) layer is not editable.
  const visibleSegmentationLayer = getVisibleSegmentationLayer(state);
  return mayEditAnnotation(state) && visibleSegmentationLayer?.tracingId != null;
}

export async function hasSegmentIndex(
  visibleSegmentationLayer: APIDataLayer,
  dataset: APIDataset,
  annotation: StoreAnnotation | null | undefined,
) {
  const maybeVolumeTracing =
    "tracingId" in visibleSegmentationLayer &&
    visibleSegmentationLayer.tracingId != null &&
    annotation != null
      ? getVolumeTracingById(annotation, visibleSegmentationLayer.tracingId)
      : null;
  let segmentIndexInDataStore = false;
  if (maybeVolumeTracing == null) {
    segmentIndexInDataStore = await hasSegmentIndexInDataStore(
      dataset.dataStore.url,
      dataset.id,
      visibleSegmentationLayer.name,
    );
  }
  return (
    visibleSegmentationLayer != null &&
    (maybeVolumeTracing?.hasSegmentIndex || segmentIndexInDataStore)
  );
}

export function withMappingActivationConfirmation(
  originalOnClick: MenuProps["onClick"],
  mappingName: string | null | undefined,
  descriptor: string,
  layerName: string | null | undefined,
  mappingInfo: ActiveMappingInfo,
) {
  const editableMapping = getEditableMappingForVolumeTracingId(Store.getState(), layerName);

  const isMappingEnabled = mappingInfo.mappingStatus === MappingStatusEnum.ENABLED;
  const enabledMappingName = isMappingEnabled ? mappingInfo.mappingName : null;

  // If the mapping name is undefined, no mapping is specified. In that case never show the activation modal.
  // In contrast, if the mapping name is null, this indicates that all mappings should be specifically disabled.
  if (mappingName === undefined || layerName == null || mappingName === enabledMappingName) {
    return originalOnClick;
  }

  const actionStr = editableMapping == null ? "will" : "cannot";
  const mappingString =
    mappingName != null
      ? `for the mapping "${mappingName}" which is not active. The mapping ${actionStr} be activated`
      : `without a mapping but a mapping is active. The mapping ${actionStr} be deactivated`;
  const recommendationStr =
    editableMapping == null
      ? ""
      : "This is because the current mapping was locked while editing it with the proofreading tool. Consider changing the active mesh file instead.";

  const confirmMappingActivation: MenuProps["onClick"] = (menuClickEvent) => {
    confirm({
      title: `The currently active ${descriptor} was computed ${mappingString} when clicking OK. ${recommendationStr}`,
      async onOk() {
        if (editableMapping != null) {
          return;
        }
        if (mappingName != null) {
          Store.dispatch(setMappingAction(layerName, mappingName, "HDF5", false));
          await waitForCondition(
            () =>
              getMappingInfo(
                Store.getState().temporaryConfiguration.activeMappingByLayer,
                layerName,
              ).mappingStatus === MappingStatusEnum.ENABLED,
            100,
          );
        } else {
          Store.dispatch(setMappingEnabledAction(layerName, false));
          await waitForCondition(
            () =>
              getMappingInfo(
                Store.getState().temporaryConfiguration.activeMappingByLayer,
                layerName,
              ).mappingStatus === MappingStatusEnum.DISABLED,
            100,
          );
        }

        if (originalOnClick) {
          originalOnClick(menuClickEvent);
        }
      },
    });
  };

  return confirmMappingActivation;
}

/**
 * Retrieves a flattened list of all segments within a given group and all of its nested subgroups.
 * If the provided `groupId` is `MISSING_GROUP_ID`, it returns all available segments.
 */
export const getSegmentsOfGroupRecursively = (
  groupId: number,
  segments: SegmentMap | null | undefined,
  segmentGroups: SegmentGroup[] | null | undefined,
): Segment[] => {
  if (segments == null || segmentGroups == null) {
    return [];
  }
  if (groupId === MISSING_GROUP_ID) {
    return Array.from(segments.values());
  }
  const groupToSegmentsMap = createGroupToSegmentsMap(segments);
  const relevantGroupIds = getGroupByIdWithSubgroups(segmentGroups, groupId);
  const segmentIdsNested = relevantGroupIds
    .map((groupId) => (groupToSegmentsMap[groupId] != null ? groupToSegmentsMap[groupId] : null))
    .filter((x) => x != null);
  return segmentIdsNested.flat() as Segment[];
};
