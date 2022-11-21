import React, { useEffect, useState } from "react";
import { DropTargetMonitor, useDrop } from "react-dnd";
import SortableTree, {
  ExtendedNodeData,
  FullTree,
  NodeData,
  OnDragPreviousAndNextLocation,
  OnMovePreviousAndNextLocation,
} from "react-sortable-tree";
// @ts-ignore
import FileExplorerTheme from "react-sortable-tree-theme-file-explorer";

import { FlatFolderTreeItem } from "types/api_flow_types";
import { DraggableDatasetType } from "../advanced_dataset/dataset_table";
import {
  DatasetCollectionContextValue,
  useDatasetCollectionContext,
} from "../dataset/dataset_collection_context";

import { DeleteOutlined, EditOutlined, FolderOutlined, PlusOutlined } from "@ant-design/icons";
import { Dropdown, Menu } from "antd";
import Toast from "libs/toast";
import { GenerateNodePropsType } from "oxalis/view/right-border-tabs/tree_hierarchy_view";
import { DragObjectWithType } from "react-dnd";

export type FolderItem = {
  title: string;
  id: string;
  parent: string | null | undefined;
  expanded?: boolean;
  children: FolderItem[];
  isEditable: boolean;
};

export function FolderTreeSidebar({
  setFolderIdForEditModal,
}: {
  setFolderIdForEditModal: (value: string | null) => void;
}) {
  const [treeData, setTreeData] = useState<FolderItem[]>([]);
  const context = useDatasetCollectionContext();

  const { data: folderTree } = context.queries.folderTreeQuery;

  useEffect(() => {
    setTreeData((prevState) => {
      const newTreeData = getFolderHierarchy(folderTree, prevState, context.activeFolderId);
      if (newTreeData.length > 0 && context.activeFolderId == null) {
        context.setActiveFolderId(newTreeData[0].id);
      }
      return newTreeData;
    });
  }, [folderTree]);

  useEffect(() => {
    if (context.activeFolderId == null && !context.globalSearchQuery) {
      // No search is active and no folder is selected. For example, this happens
      // after clearing the search box.
      // Activate the root folder.
      if (treeData.length > 0) {
        context.setActiveFolderId(treeData[0].id);
      }
    }
  }, [context.activeFolderId, context.globalSearchQuery, treeData.length]);

  // This useDrop is only used to highlight the sidebar when
  // a dataset is dragged. This helps the user to understand that
  // the dataset should be dragged to folders in the sidebar.
  // The actual dnd operation is handled by the individual folder
  // entries (see FolderItemAsDropTarget), though.
  const [isDraggingDataset, drop] = useDrop({
    accept: DraggableDatasetType,
    collect: (monitor: DropTargetMonitor) => monitor.canDrop(),
  });

  const onMoveNode = (
    params: NodeData<FolderItem> & FullTree<FolderItem> & OnMovePreviousAndNextLocation<FolderItem>,
  ) => {
    const { nextParentNode: newParent, node: draggedItem } = params;
    if (newParent != null) {
      context.queries.moveFolderMutation.mutateAsync([draggedItem.id, newParent.id]);
    }
  };

  const canDropFolder = (params: OnDragPreviousAndNextLocation): boolean => {
    const sourceAllowed = (params.prevParent as FolderItem | null)?.isEditable ?? false;
    const targetAllowed = (params.nextParent as FolderItem | null)?.isEditable ?? false;
    return sourceAllowed && targetAllowed;
  };

  const canDragFolder = (params: ExtendedNodeData): boolean =>
    (params.node as FolderItem).isEditable;
  return (
    <div
      ref={drop}
      className={isDraggingDataset ? "highlight-folder-sidebar" : ""}
      style={{
        height: 400,
        width: 250,
        marginRight: 4,
        borderRadius: 2,
        padding: 2,
      }}
    >
      <SortableTree
        treeData={treeData}
        onChange={(newTreeData: FolderItem[]) => {
          setTreeData(newTreeData);
        }}
        onMoveNode={onMoveNode}
        theme={FileExplorerTheme}
        canDrag={canDragFolder}
        canDrop={canDropFolder}
        generateNodeProps={(params) =>
          generateNodeProps(
            context,
            // @ts-ignore
            params as ExtendedNodeData<FolderItem>,
            setFolderIdForEditModal,
          )
        }
      />
    </div>
  );
}

function getFolderHierarchy(
  folderTree: FlatFolderTreeItem[] | undefined,
  prevFolderItems: FolderItem[] | null,
  activeFolderId: string | null,
): FolderItem[] {
  if (folderTree == null) {
    return [];
  }
  const roots: FolderItem[] = [];
  const itemById: Record<string, FolderItem> = {};
  for (const folderTreeItem of folderTree) {
    const treeItem = {
      id: folderTreeItem.id,
      title: folderTreeItem.name,
      isEditable: folderTreeItem.isEditable,
      parent: folderTreeItem.parent,
      expanded: false,
      children: [],
    };
    if (folderTreeItem.parent == null) {
      roots.push(treeItem);
    }
    itemById[folderTreeItem.id] = treeItem;
  }

  for (const folderTreeItem of folderTree) {
    if (folderTreeItem.parent != null) {
      itemById[folderTreeItem.parent].children.push(itemById[folderTreeItem.id]);
    }
  }

  for (const folderTreeItem of folderTree) {
    if (folderTreeItem.parent != null) {
      itemById[folderTreeItem.parent].children.sort((a, b) => a.title.localeCompare(b.title));
    }
  }

  if (roots.length === 1) {
    roots[0].expanded = true;
  } else {
    throw new Error("Multiple folder roots found");
  }

  // Expand the parent chain of the active folder.
  if (activeFolderId != null) {
    let currentFolder = itemById[activeFolderId];
    while (currentFolder?.parent != null) {
      currentFolder = itemById[currentFolder.parent];
      currentFolder.expanded = true;
    }
  }

  // Copy the expanded flags from the old state
  forEachFolderItem(prevFolderItems || [], (item: FolderItem) => {
    const maybeItem = itemById[item.id];
    if (maybeItem != null) {
      maybeItem.expanded = item.expanded;
    }
  });

  return roots;
}

function forEachFolderItem(roots: FolderItem[], fn: (item: FolderItem) => void) {
  for (const item of roots) {
    fn(item);
    forEachFolderItem(item.children, fn);
  }
}

function generateNodeProps(
  context: DatasetCollectionContextValue,
  params: ExtendedNodeData<FolderItem>,
  setFolderIdForEditModal: (folderId: string) => void,
): GenerateNodePropsType {
  const { node } = params;
  const { id, title, isEditable } = node;
  const nodeProps: GenerateNodePropsType = {};

  function createFolder(): void {
    const folderName = prompt("Please input a name for the new folder");
    context.queries.createFolderMutation.mutateAsync([id, folderName || "New folder"]);
  }
  function deleteFolder(): void {
    context.queries.deleteFolderMutation.mutateAsync(id);
  }

  function editFolder(): void {
    setFolderIdForEditModal(id);
  }

  const createMenu = () => (
    <Menu>
      <Menu.Item key="create" data-group-id={id} onClick={createFolder}>
        <PlusOutlined />
        New Folder
      </Menu.Item>
      <Menu.Item key="edit" data-group-id={id} onClick={editFolder}>
        <EditOutlined />
        Edit Folder
      </Menu.Item>

      <Menu.Item key="delete" data-group-id={id} onClick={deleteFolder}>
        <DeleteOutlined />
        Delete Folder
      </Menu.Item>
    </Menu>
  );

  nodeProps.title = (
    <div>
      <Dropdown
        overlay={createMenu}
        placement="bottom"
        // The overlay is generated lazily. By default, this would make the overlay
        // re-render on each parent's render() after it was shown for the first time.
        // The reason for this is that it's not destroyed after closing.
        // Therefore, autoDestroy is passed.
        // destroyPopupOnHide should also be an option according to the docs, but
        // does not work properly. See https://github.com/react-component/trigger/issues/106#issuecomment-948532990
        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; overlay: () => Element;... Remove this comment to see the full error message
        autoDestroy
        trigger={["contextMenu"]}
      >
        <FolderItemAsDropTarget
          onClick={() => context.setActiveFolderId(id)}
          folderId={id}
          isEditable={isEditable}
        >
          <FolderOutlined />
          {title}
        </FolderItemAsDropTarget>
      </Dropdown>
    </div>
  );

  return nodeProps;
}

function FolderItemAsDropTarget(props: {
  folderId: string;
  children: React.ReactNode;
  className?: string;
  onClick: () => void;
  isEditable: boolean;
}) {
  const context = useDatasetCollectionContext();
  const { folderId, className, isEditable, ...restProps } = props;

  const [collectedProps, drop] = useDrop({
    accept: DraggableDatasetType,
    drop: (item: DragObjectWithType & { datasetName: string }) => {
      const dataset = context.datasets.find((ds) => ds.name === item.datasetName);

      if (dataset) {
        context.queries.updateDatasetMutation.mutateAsync([dataset, folderId]);
      } else {
        Toast.error("Could not move dataset. Please try again.");
      }
    },
    canDrop: () => isEditable,
    collect: (monitor: DropTargetMonitor) => ({
      canDrop: monitor.canDrop(),
      isOver: monitor.isOver(),
    }),
  });
  const { canDrop, isOver } = collectedProps;
  return (
    <div
      className={`${className || ""} folder-item ${isOver && canDrop ? "valid-drop-target" : ""} ${
        context.activeFolderId === folderId ? "active-folder-item" : ""
      }`}
      ref={drop}
      style={{ userSelect: "none", cursor: "pointer" }}
      {...restProps}
    >
      {props.children}
    </div>
  );
}
