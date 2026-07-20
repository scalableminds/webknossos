import { ExclamationCircleOutlined } from "@ant-design/icons";
import { Modal } from "antd";
import { useWkSelector } from "libs/react_hooks";
import React, { useCallback, useState } from "react";
import { useDispatch } from "react-redux";
import type { Vector3 } from "viewer/constants";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { getVisibleSegments } from "viewer/model/accessors/volumetracing_accessor";
import {
  batchUpdateGroupsAndSegmentsAction,
  setExpandedSegmentGroupsAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { api } from "viewer/singletons";
import type { Segment } from "viewer/store";
import {
  additionallyExpandGroup,
  createGroupToParentMap,
  getDescendantGroupIds,
  getExpandedGroups,
  MISSING_GROUP_ID,
} from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";
import { getGroupUiNodeKey, type SegmentsUiNode } from "../hierarchy";
import { getSegmentsOfGroupRecursively as getSegmentsOfGroupRecursivelyHelper } from "../segments_view_helper";

export type SegmentGroupOperations = {
  // Group id for which the "keep vs. delete children" modal is currently shown.
  groupIdPendingDeletion: number | null;
  createGroup: (parentGroupId: number) => void;
  // Starts the deletion flow (which may show confirmation dialogs, depending on the group).
  requestGroupDeletion: (groupId: number) => void;
  confirmGroupDeletion: (deleteChildren: boolean) => void;
  cancelGroupDeletion: () => void;
  moveSegmentsToGroup: (segmentIds: number[], targetGroupId: number | null | undefined) => void;
  moveGroupToGroup: (groupId: number, targetGroupId: number | null | undefined) => void;
  // Resolves all segments of a group and its subgroups (all segments for the root group).
  getSegmentsOfGroupRecursively: (groupId: number) => Segment[];
  setSegmentColor: (segments: Segment[], color: Vector3 | null) => void;
  setExpandedGroups: (expandedKeys: Set<string>) => void;
  expandParentsOfNode: (node: SegmentsUiNode) => void;
  setSubgroupsExpansion: (groupId: number, expanded: boolean) => void;
};

export function useSegmentGroupOperations(): SegmentGroupOperations {
  const dispatch = useDispatch();
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
  const segments = useWkSelector((state) => getVisibleSegments(state).segments);
  const segmentGroups = useWkSelector((state) => getVisibleSegments(state).segmentGroups);
  const [groupIdPendingDeletion, setGroupIdPendingDeletion] = useState<number | null>(null);

  const createGroup = useCallback(
    (parentGroupId: number) => {
      if (visibleSegmentationLayer == null) {
        return;
      }
      api.tracing.createSegmentGroup(null, parentGroupId, visibleSegmentationLayer.name);
    },
    [visibleSegmentationLayer],
  );

  const deleteGroup = useCallback(
    (groupId: number, deleteChildren: boolean) => {
      if (visibleSegmentationLayer == null) {
        return;
      }
      api.tracing.deleteSegmentGroup(groupId, deleteChildren, visibleSegmentationLayer.name);
    },
    [visibleSegmentationLayer],
  );

  const requestGroupDeletion = useCallback(
    (groupId: number) => {
      // A group counts as empty when it has neither subgroups nor (recursively)
      // any segments. getDescendantGroupIds/getSegmentsOfGroupRecursively work on
      // the nested group tree, so this also applies to nested subgroups (a flat
      // segmentGroups.find() would miss those).
      const isEmptyGroup =
        getDescendantGroupIds(segmentGroups, groupId).length === 0 &&
        getSegmentsOfGroupRecursivelyHelper(groupId, segments, segmentGroups).length === 0;

      if (groupId !== MISSING_GROUP_ID && isEmptyGroup) {
        // The group is empty, delete it without asking.
        deleteGroup(groupId, false);
      } else if (groupId === MISSING_GROUP_ID) {
        // Ask whether all children of the root group should be deleted
        // (doesn't need the recursive/not-recursive distinction, since
        // the root group itself cannot be removed).
        Modal.confirm({
          title: "Do you want to delete all segments and groups?",
          icon: React.createElement(ExclamationCircleOutlined),
          okType: "danger",
          okText: "Delete",
          onOk: () => deleteGroup(groupId, false),
        });
      } else {
        setGroupIdPendingDeletion(groupId);
      }
    },
    [segments, segmentGroups, deleteGroup],
  );

  const confirmGroupDeletion = useCallback(
    (deleteChildren: boolean) => {
      setGroupIdPendingDeletion(null);
      if (groupIdPendingDeletion != null) {
        deleteGroup(groupIdPendingDeletion, deleteChildren);
      }
    },
    [groupIdPendingDeletion, deleteGroup],
  );

  const cancelGroupDeletion = useCallback(() => {
    setGroupIdPendingDeletion(null);
  }, []);

  const moveSegmentsToGroup = useCallback(
    (segmentIds: number[], targetGroupId: number | null | undefined) => {
      if (visibleSegmentationLayer == null || segmentIds.length === 0) {
        return;
      }
      const groupId =
        targetGroupId == null || targetGroupId === MISSING_GROUP_ID ? null : targetGroupId;
      dispatch(
        batchUpdateGroupsAndSegmentsAction(
          segmentIds.map((segmentId) =>
            updateSegmentAction(
              segmentId,
              { groupId },
              visibleSegmentationLayer.name,
              undefined,
              true,
            ),
          ),
        ),
      );
    },
    [dispatch, visibleSegmentationLayer],
  );

  const moveGroupToGroup = useCallback(
    (groupId: number, targetGroupId: number | null | undefined) => {
      if (visibleSegmentationLayer == null) {
        return;
      }
      api.tracing.moveSegmentGroup(groupId, targetGroupId, visibleSegmentationLayer.name);
    },
    [visibleSegmentationLayer],
  );

  const getSegmentsOfGroupRecursively = useCallback(
    (groupId: number): Segment[] =>
      getSegmentsOfGroupRecursivelyHelper(groupId, segments, segmentGroups),
    [segments, segmentGroups],
  );

  const setSegmentColor = useCallback(
    (segmentsToUpdate: Segment[], color: Vector3 | null) => {
      if (visibleSegmentationLayer == null || segmentsToUpdate.length === 0) {
        return;
      }
      dispatch(
        batchUpdateGroupsAndSegmentsAction(
          segmentsToUpdate.map((segment) =>
            updateSegmentAction(segment.id, { color }, visibleSegmentationLayer.name),
          ),
        ),
      );
    },
    [dispatch, visibleSegmentationLayer],
  );

  const setExpandedGroups = useCallback(
    (expandedKeys: Set<string>) => {
      if (visibleSegmentationLayer == null) {
        return;
      }
      dispatch(setExpandedSegmentGroupsAction(expandedKeys, visibleSegmentationLayer.name));
    },
    [dispatch, visibleSegmentationLayer],
  );

  const expandParentsOfNode = useCallback(
    (node: SegmentsUiNode) => {
      const groupIdToExpand =
        node.type === "segment"
          ? node.segment.groupId
          : createGroupToParentMap(segmentGroups)[node.group.groupId];
      const expandedKeys = additionallyExpandGroup(
        segmentGroups,
        groupIdToExpand,
        getGroupUiNodeKey,
      );
      if (expandedKeys != null) {
        setExpandedGroups(expandedKeys);
      }
    },
    [segmentGroups, setExpandedGroups],
  );

  const setSubgroupsExpansion = useCallback(
    (groupId: number, expanded: boolean) => {
      const expandedKeys = new Set(
        getExpandedGroups(segmentGroups).map((group) => getGroupUiNodeKey(group.groupId)),
      );
      for (const subgroupId of getDescendantGroupIds(segmentGroups, groupId)) {
        if (expanded) {
          expandedKeys.add(getGroupUiNodeKey(subgroupId));
        } else {
          expandedKeys.delete(getGroupUiNodeKey(subgroupId));
        }
      }
      // Expanding subgroups also expands the group itself; collapsing leaves it as-is.
      if (expanded && groupId !== MISSING_GROUP_ID) {
        expandedKeys.add(getGroupUiNodeKey(groupId));
      }
      setExpandedGroups(expandedKeys);
    },
    [segmentGroups, setExpandedGroups],
  );

  return {
    groupIdPendingDeletion,
    createGroup,
    requestGroupDeletion,
    confirmGroupDeletion,
    cancelGroupDeletion,
    moveSegmentsToGroup,
    moveGroupToGroup,
    getSegmentsOfGroupRecursively,
    setSegmentColor,
    setExpandedGroups,
    expandParentsOfNode,
    setSubgroupsExpansion,
  };
}
