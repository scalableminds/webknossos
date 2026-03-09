import { hasSegmentIndexInDataStore } from "admin/rest_api";
import { type MenuProps, Modal } from "antd";
import type { BasicDataNode } from "antd/es/tree";
import { waitForCondition } from "libs/utils";
import memoize from "lodash-es/memoize";
import sortBy from "lodash-es/sortBy";
import type { APIDataLayer, APIDataset } from "types/api_types";
import { MappingStatusEnum, type Vector3 } from "viewer/constants";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import {
  getEditableMappingForVolumeTracingId,
  getVolumeTracingById,
} from "viewer/model/accessors/volumetracing_accessor";
import { setMappingAction, setMappingEnabledAction } from "viewer/model/actions/settings_actions";
import type { TreeGroup } from "viewer/model/types/tree_types";
import type { ActiveMappingInfo, Segment, SegmentGroup, StoreAnnotation } from "viewer/store";
import Store from "viewer/store";
import {
  additionallyExpandGroup,
  createGroupToParentMap,
  createGroupToSegmentsMap,
  getExpandedGroups,
  getGroupByIdWithSubgroups,
  getGroupNodeKey,
  MISSING_GROUP_ID,
} from "../trees_tab/tree_hierarchy_view_helpers";

const { confirm } = Modal;

export type SegmentHierarchyGroup = BasicDataNode & {
  title: string;
  type: "group";
  name: string | null | undefined;
  id: number;
  key: string;
  isExpanded?: boolean;
  children: Array<SegmentHierarchyNode>;
  // This type does not have an isChecked property, because that will
  // be determined automatically by antd by looking at isChecked of
  // the children.
};

export type SegmentHierarchyLeaf = BasicDataNode &
  Segment & {
    type: "segment";
    key: string;
    title: string;
    children?: undefined;
    isChecked: boolean;
  };

export type SegmentHierarchyNode = SegmentHierarchyLeaf | SegmentHierarchyGroup;

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

export const getExpandedKeys = (segmentGroups: SegmentGroup[]) => {
  return getExpandedGroups(segmentGroups).map((group) => getGroupNodeKey(group.groupId));
};

export const getExpandedKeysWithRoot = memoize((segmentGroups: SegmentGroup[]) => {
  const expandedGroups = getExpandedKeys(segmentGroups);
  expandedGroups.unshift(getGroupNodeKey(MISSING_GROUP_ID));
  return expandedGroups;
});

export function constructTreeData(
  groups: { name: string; groupId: number; children: SegmentGroup[] }[],
  groupToSegmentsMap: Record<number, Segment[]>,
): SegmentHierarchyNode[] {
  // Insert all trees into their respective groups in the group hierarchy and transform groups to tree nodes
  return sortBy(groups, "groupId").map((group) => {
    const { groupId } = group;
    const segments = groupToSegmentsMap[groupId] || [];
    const treeNode: SegmentHierarchyNode = {
      ...group,
      title: group.name || "<Unnamed Group>",
      key: getGroupNodeKey(groupId),
      id: groupId,
      type: "group",
      children: constructTreeData(group.children, groupToSegmentsMap).concat(
        sortBy(segments, "id").map(
          (segment): SegmentHierarchyNode => ({
            ...segment,
            title: segment.name || "",
            type: "segment",
            key: `segment-${segment.id}`,
            id: segment.id,
            isChecked: segment.isVisible,
          }),
        ),
      ),
    };
    return treeNode;
  });
}

export const getSegmentsOfGroupRecursively = (
  groupId: number,
  segments: any | null | undefined, // any = Collection<Segment> or Map<number, Segment>
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

export const calculateExpandedParentGroups = (
  selectedElement: SegmentHierarchyNode,
  segmentGroups: TreeGroup[],
): Set<string> | null | undefined => {
  const groupToExpand =
    selectedElement.type === "segment"
      ? selectedElement.groupId
      : createGroupToParentMap(segmentGroups)[selectedElement.id];
  return additionallyExpandGroup(segmentGroups, groupToExpand, getGroupNodeKey);
};

export function visitAllItems(
  nodes: Array<SegmentHierarchyNode>,
  callback: (group: SegmentHierarchyNode) => void,
) {
  for (const node of nodes) {
    callback(node);
    if ("children" in node && node.children != null) {
      visitAllItems(node.children, callback);
    }
  }
}
