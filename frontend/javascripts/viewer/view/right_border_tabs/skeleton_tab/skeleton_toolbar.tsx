import Icon, {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ArrowsAltOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FolderAddOutlined,
  MenuOutlined,
  PlusOutlined,
  SearchOutlined,
  SortAscendingOutlined,
  SwapOutlined,
  UploadOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import ToggleOffIcon from "@images/icons/icon-toggle-off.svg?react";
import ToggleOnIcon from "@images/icons/icon-toggle-on.svg?react";
import { Dropdown, type MenuProps, Modal, Space } from "antd";
import { useWkSelector } from "libs/react_hooks";
import messages from "messages";
import { useDispatch } from "react-redux";
import {
  isAgglomerateTree,
  isAnnotationOwner,
  isConcurrentCollaborationMode,
  mayEditAnnotation,
} from "viewer/model/accessors/annotation_accessor";
import {
  areGeometriesTransformed,
  enforceSkeletonTracing,
} from "viewer/model/accessors/skeletontracing_accessor";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import {
  createTreeAction,
  deleteTreesAction,
  expandParentGroupsOfTreeAction,
  selectNextTreeAction,
  setActiveTreeAction,
  setActiveTreeGroupAction,
  setExpandedTreeGroupsByIdsAction,
  shuffleAllTreeColorsAction,
  toggleAllTreesAction,
  toggleInactiveTreesAction,
} from "viewer/model/actions/skeletontracing_actions";
import { handleDeleteTreeByUser } from "viewer/model/actions/skeletontracing_actions_with_effects";
import { setDropzoneModalVisibilityAction } from "viewer/model/actions/ui_actions";
import ButtonComponent from "viewer/view/components/button_component";
import {
  additionallyExpandGroup,
  createGroupToParentMap,
  MISSING_GROUP_ID,
} from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";
import AdvancedSearchPopover from "../advanced_search_popover";
import { getNodeName, type SkeletonHierarchy, type SkeletonUiNode } from "./hierarchy";
import {
  checkAndConfirmDeletingInitialNode,
  type GroupOperations,
} from "./hooks/use_group_operations";
import type { SkeletonExport } from "./hooks/use_skeleton_export";
import type { TreeSelection } from "./hooks/use_tree_selection";
import { showAllSkeletonsLengthNotification } from "./measurements";

export const skeletonTabId = "tree-list";

function showConfirmWarningModal(title: string, content: string, onConfirm: () => void) {
  Modal.confirm({
    title,
    content,
    okText: "Ok",
    cancelText: "No",
    autoFocusButton: "cancel",
    icon: <WarningOutlined />,
    onCancel: () => {},
    onOk: onConfirm,
  });
}

type Props = {
  hierarchy: SkeletonHierarchy;
  selection: TreeSelection;
  groupOperations: GroupOperations;
  skeletonExport: SkeletonExport;
};

export function SkeletonToolbar({ hierarchy, selection, groupOperations, skeletonExport }: Props) {
  const dispatch = useDispatch();
  const allowUpdate = useWkSelector(mayEditAnnotation);
  const isConcurrentCollabMode = useWkSelector(isConcurrentCollaborationMode);
  const trees = useWkSelector((state) => enforceSkeletonTracing(state.annotation).trees);
  const treeGroups = useWkSelector((state) => enforceSkeletonTracing(state.annotation).treeGroups);
  const activeGroupId = useWkSelector(
    (state) => enforceSkeletonTracing(state.annotation).activeGroupId,
  );
  const sortTreesByName = useWkSelector((state) => state.userConfiguration.sortTreesByName);
  const isSkeletonLayerTransformed = useWkSelector(areGeometriesTransformed);
  const isAnnotationLockedByUser = useWkSelector((state) => state.annotation.isLockedByOwner);
  const isOwner = useWkSelector(isAnnotationOwner);

  const isEditingDisabled = !allowUpdate || isConcurrentCollabMode;
  const isEditingDisabledMessage = isConcurrentCollabMode
    ? messages["tracing.skeleton_editing_disabled_in_live_collab"]
    : messages["tracing.read_only_mode_notification"](isAnnotationLockedByUser, isOwner);

  // Used to keep the delete button enabled in concurrent collaboration
  // mode when the deletion is actually permitted (only agglomerate trees, i.e. proofreading).
  const isDeleteOnlyAffectingAgglomerateTrees = () => {
    const treeIdsToDelete = selection.selectedTreeIds;
    return (
      treeIdsToDelete.length > 0 &&
      treeIdsToDelete.every((treeId) => isAgglomerateTree(trees.getNullable(treeId)))
    );
  };
  const isDeleteDisabled =
    !allowUpdate || (isConcurrentCollabMode && !isDeleteOnlyAffectingAgglomerateTrees());

  const expandParentGroupsOf = (node: SkeletonUiNode) => {
    if (node.type === "tree") {
      dispatch(expandParentGroupsOfTreeAction(node.tree));
    } else {
      const parentGroupId = createGroupToParentMap(treeGroups)[node.group.groupId];
      const expandedGroupIds = additionallyExpandGroup(treeGroups, parentGroupId, (id) => id);
      if (expandedGroupIds != null) {
        dispatch(setExpandedTreeGroupsByIdsAction(expandedGroupIds));
      }
    }
  };

  const onSearchSelect = (node: SkeletonUiNode) => {
    expandParentGroupsOf(node);
    if (node.type === "tree") {
      dispatch(setActiveTreeAction(node.tree.treeId));
    } else {
      dispatch(setActiveTreeGroupAction(node.group.groupId));
    }
  };

  const onSelectAllMatchingTrees = (matchingNodes: SkeletonUiNode[]) => {
    const treeIds = matchingNodes.flatMap((node) => {
      if (node.type !== "tree") {
        return [];
      }
      expandParentGroupsOf(node);
      return [node.tree.treeId];
    });
    // selectTrees also deselects the active group.
    selection.selectTrees(treeIds);
  };

  const onDeleteSelection = () => {
    const { selectedTreeIds } = selection;

    if (selectedTreeIds.length > 1) {
      showConfirmWarningModal(
        "Delete all selected trees?",
        messages["tracing.delete_multiple_trees"]({
          countOfTrees: selectedTreeIds.length,
        }),
        () => {
          checkAndConfirmDeletingInitialNode(selectedTreeIds).then(() => {
            dispatch(deleteTreesAction(selectedTreeIds));
            selection.deselectAllTrees();
          });
        },
      );
    } else {
      // Just delete the active tree.
      handleDeleteTreeByUser();
    }

    // If there is an active group, ask the user whether to delete it or not.
    if (activeGroupId != null) {
      groupOperations.requestGroupDeletion(activeGroupId);
    }
  };

  const actionsMenu: MenuProps = {
    selectedKeys: [sortTreesByName ? "sortByName" : "sortByTime"],
    items: [
      {
        key: "sort",
        icon: <SortAscendingOutlined />,
        label: "Sort",
        children: [
          {
            key: "sortByName",
            label: "by name",
            onClick: () => dispatch(updateUserSettingAction("sortTreesByName", true)),
          },
          {
            key: "sortByTime",
            label: "by creation time",
            onClick: () => dispatch(updateUserSettingAction("sortTreesByName", false)),
          },
        ],
      },
      { type: "divider" },
      {
        key: "shuffleAllTreeColors",
        onClick: () => dispatch(shuffleAllTreeColorsAction()),
        title: "Shuffle All Tree Colors",
        disabled: isEditingDisabled,
        icon: <SwapOutlined />,
        label: "Shuffle All Tree Colors",
      },
      {
        key: "handleNmlDownload",
        onClick: () => skeletonExport.downloadNml(false),
        icon: <DownloadOutlined />,
        label: "Download Visible Trees NML",
        title: "Download Visible Trees as NML",
      },
      isSkeletonLayerTransformed
        ? {
            key: "handleNmlDownloadTransformed",
            onClick: () => skeletonExport.downloadNml(true),
            icon: <DownloadOutlined />,
            label: "Download Visible Trees NML (Transformed)",
            title: "The currently active transformation will be applied to each node.",
          }
        : null,
      {
        key: "handleCSVDownload",
        onClick: () => skeletonExport.downloadCsv(false),
        icon: <DownloadOutlined />,
        label: "Download Visible Trees CSV",
        title: "Download Visible Trees as CSV",
      },
      isSkeletonLayerTransformed
        ? {
            key: "handleCSVDownloadTransformed",
            onClick: () => skeletonExport.downloadCsv(true),
            icon: <DownloadOutlined />,
            label: "Download Visible Trees (Transformed) CSV",
            title: "The currently active transformation will be applied to each node.",
          }
        : null,
      {
        key: "importNml",
        onClick: () => dispatch(setDropzoneModalVisibilityAction(true)),
        title: "Import NML files",
        disabled: isEditingDisabled,
        icon: <UploadOutlined />,
        label: "Import NML",
      },
      {
        key: "measureAllSkeletons",
        onClick: showAllSkeletonsLengthNotification,
        title: "Measure Length of All Skeletons",
        icon: <ArrowsAltOutlined />,
        label: "Measure Length of All Skeletons",
      },
    ],
  };

  return (
    <Space wrap>
      <AdvancedSearchPopover
        onSelect={onSearchSelect}
        data={hierarchy.flatNodes}
        searchKey={getNodeName}
        provideShortcut
        targetId={skeletonTabId}
        onSelectAllMatches={onSelectAllMatchingTrees}
      >
        <ButtonComponent
          title="Open search via CTRL + Shift + F"
          icon={<SearchOutlined />}
          variant="text"
          color="default"
        />
      </AdvancedSearchPopover>
      <ButtonComponent
        onClick={() => dispatch(createTreeAction())}
        title={isEditingDisabled ? isEditingDisabledMessage : "Create new Tree (C)"}
        disabled={isEditingDisabled}
        icon={<PlusOutlined />}
        variant="text"
        color="default"
      />
      <ButtonComponent
        onClick={() => groupOperations.createGroup(MISSING_GROUP_ID)}
        title={isEditingDisabled ? isEditingDisabledMessage : "Create new Group"}
        disabled={isEditingDisabled}
        icon={<FolderAddOutlined />}
        variant="text"
        color="default"
      />
      <ButtonComponent
        onClick={onDeleteSelection}
        title={isDeleteDisabled ? isEditingDisabledMessage : "Delete Selected Trees"}
        disabled={isDeleteDisabled}
        icon={<DeleteOutlined />}
        variant="text"
        color="default"
      />
      <ButtonComponent
        onClick={() => dispatch(toggleAllTreesAction())}
        title="Toggle Visibility of All Trees (1)"
        disabled={isEditingDisabled}
        icon={<Icon component={ToggleOnIcon} />}
        variant="text"
        color="default"
      />
      <ButtonComponent
        onClick={() => dispatch(toggleInactiveTreesAction())}
        title="Toggle Visibility of Inactive Trees (2)"
        disabled={isEditingDisabled}
        icon={<Icon component={ToggleOffIcon} />}
        variant="text"
        color="default"
      />
      <ButtonComponent
        onClick={() => dispatch(selectNextTreeAction(false))}
        title="Select previous tree"
        icon={<ArrowLeftOutlined />}
        variant="text"
        color="default"
      />
      <ButtonComponent
        onClick={() => dispatch(selectNextTreeAction(true))}
        title="Select next tree"
        icon={<ArrowRightOutlined />}
        variant="text"
        color="default"
      />
      <Dropdown menu={actionsMenu} trigger={["click"]}>
        <ButtonComponent
          icon={<MenuOutlined />}
          variant="text"
          color="default"
          title="More actions"
        />
      </Dropdown>
    </Space>
  );
}
