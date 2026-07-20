import {
  FolderAddOutlined,
  LoadingOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Popover, Space } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useState } from "react";
import ButtonComponent from "viewer/view/components/button_component";
import AdvancedSearchPopover from "../advanced_search_popover";
import { MISSING_GROUP_ID } from "../shared/tree_hierarchy_view_helpers";
import { getUiNodeName, type SegmentsHierarchy, type SegmentsUiNode } from "./hierarchy";
import type { MeshFiles } from "./hooks/use_mesh_files";
import type { SegmentGroupOperations } from "./hooks/use_segment_group_operations";
import type { SegmentSelection } from "./hooks/use_segment_selection";
import { MeshSettingsPopover } from "./mesh_settings_popover";
import { PrecomputeMeshesPopover } from "./precompute_meshes_popover";
import { mayEditVisibleSegmentation } from "./segments_view_helper";

export const segmentsTabId = "segment-list";

type Props = {
  hierarchy: SegmentsHierarchy;
  selection: SegmentSelection;
  groupOperations: SegmentGroupOperations;
  meshFiles: MeshFiles;
};

export function SegmentsToolbar({ hierarchy, selection, groupOperations, meshFiles }: Props) {
  const allowUpdate = useWkSelector(mayEditVisibleSegmentation);
  const [isMeshPrecomputeRunning, setIsMeshPrecomputeRunning] = useState(false);

  const onSearchSelect = (node: SegmentsUiNode) => {
    groupOperations.expandParentsOfNode(node);
    if (node.type === "segment") {
      selection.selectSegmentAndJumpToPosition(node.segment);
    } else {
      selection.focusSelection([], node.group.groupId);
    }
  };

  const onSelectAllMatches = (matchingNodes: SegmentsUiNode[]) => {
    const matchingSegmentIds = matchingNodes.flatMap((node) => {
      if (node.type !== "segment") {
        return [];
      }
      groupOperations.expandParentsOfNode(node);
      return [node.segment.id];
    });
    selection.focusSelection(matchingSegmentIds, null);
  };

  return (
    <Space>
      <AdvancedSearchPopover
        onSelect={onSearchSelect}
        data={hierarchy.flatNodes}
        searchKey={getUiNodeName}
        provideShortcut
        targetId={segmentsTabId}
        onSelectAllMatches={onSelectAllMatches}
      >
        <ButtonComponent
          title="Open search via CTRL + Shift + F"
          icon={<SearchOutlined />}
          variant="text"
          color="default"
        />
      </AdvancedSearchPopover>
      <ButtonComponent
        onClick={() => groupOperations.createGroup(MISSING_GROUP_ID)}
        title={!allowUpdate ? "Cannot create group in read-only mode" : "Create new Group"}
        disabled={!allowUpdate}
        icon={<FolderAddOutlined />}
        variant="text"
        color="default"
      />
      <Popover
        content={<PrecomputeMeshesPopover onActiveJobChange={setIsMeshPrecomputeRunning} />}
        trigger="click"
        placement="bottom"
      >
        <ButtonComponent
          title="Add a precomputed mesh file"
          icon={isMeshPrecomputeRunning ? <LoadingOutlined spin /> : <PlusOutlined />}
          variant="text"
          color="default"
        />
      </Popover>
      <Popover
        content={<MeshSettingsPopover meshFiles={meshFiles} />}
        trigger="click"
        placement="bottom"
      >
        <ButtonComponent
          title="Configure mesh computation"
          icon={<SettingOutlined />}
          variant="text"
          color="default"
        />
      </Popover>
    </Space>
  );
}
