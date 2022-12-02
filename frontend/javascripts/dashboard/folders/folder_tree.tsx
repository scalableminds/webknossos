import React, { useCallback, useEffect, useRef, useState } from "react";
import { DropTargetMonitor, useDrop } from "react-dnd";
import { FlatFolderTreeItem } from "types/api_flow_types";
import { DraggableDatasetType } from "../advanced_dataset/dataset_table";
import {
  DatasetCollectionContextValue,
  useDatasetCollectionContext,
} from "../dataset/dataset_collection_context";

import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { Dropdown, Menu } from "antd";
import Toast from "libs/toast";
import { DragObjectWithType } from "react-dnd";
import Tree, { DataNode, DirectoryTreeProps } from "antd/lib/tree";
import { Key } from "antd/lib/table/interface";
import memoizeOne from "memoize-one";
import classNames from "classnames";

const { DirectoryTree } = Tree;

export type FolderItem = {
  title: string;
  key: string;
  parent: string | null | undefined;
  children: FolderItem[];
  isEditable: boolean;
};

const isNodeDraggable = (node: DataNode): boolean => (node as FolderItem).isEditable;
const draggableConfig = { icon: false, nodeDraggable: isNodeDraggable };

export function FolderTreeSidebar({
  setFolderIdForEditModal,
}: {
  setFolderIdForEditModal: (value: string | null) => void;
}) {
  const [treeData, setTreeData] = useState<FolderItem[]>([]);
  const context = useDatasetCollectionContext();
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const itemByIdRef = useRef<Record<string, FolderItem>>({});

  const { data: folderTree, isLoading } = context.queries.folderTreeQuery;

  useEffect(() => {
    const [newTreeData, newExpandedKeys, itemById] = getFolderHierarchy(
      folderTree,
      expandedKeys,
      context.activeFolderId,
    );
    itemByIdRef.current = itemById;
    if (
      newTreeData.length > 0 &&
      (context.activeFolderId == null || itemById[context.activeFolderId] == null)
    ) {
      // Select the root if there's no active folder id or if the active folder id doesn't
      // exist in the tree data (e.g., happens when deleting the active folder).
      context.setActiveFolderId(newTreeData[0].key);
    }
    setTreeData(newTreeData);
    setExpandedKeys(newExpandedKeys);
  }, [folderTree]);

  useEffect(() => {
    if (context.activeFolderId == null && !context.globalSearchQuery) {
      // No search is active and no folder is selected. For example, this happens
      // after clearing the search box.
      // Activate the root folder.
      if (treeData.length > 0) {
        context.setActiveFolderId(treeData[0].key);
      }
    }
  }, [context.activeFolderId, context.globalSearchQuery, treeData.length]);

  // This useDrop is only used to highlight the sidebar when
  // a dataset is dragged. This helps the user to understand that
  // the dataset should be dragged to folders in the sidebar.
  // The actual dnd operation is handled by the individual folder
  // entries (see FolderItemAsDropTarget).
  const [isDraggingDataset, drop] = useDrop({
    accept: DraggableDatasetType,
    collect: (monitor: DropTargetMonitor) => monitor.canDrop(),
  });

  const onSelect: DirectoryTreeProps["onSelect"] = useCallback(
    (keys, event) => {
      // Without the following check, the onSelect callback would also be called by antd
      // when the user clicks on a menu entry in the context menu (e.g., deleting a folder
      // would directly select it afterwards).
      // Since the context menu is inserted at the root of the DOM, it's not a child node of
      // the ant-tree container. Therefore, we can use this property to filter out those
      // click events.
      // The classic preventDefault() didn't work as an alternative workaround.
      const doesEventReferToTreeUi = event.nativeEvent.target.closest(".ant-tree") != null;
      if (keys.length > 0 && doesEventReferToTreeUi) {
        context.setActiveFolderId(keys[0] as string);
      }
    },
    [context],
  );

  const onExpand: DirectoryTreeProps["onExpand"] = (keys: Key[]) => {
    setExpandedKeys(keys as string[]);
  };
  const titleRender = useCallback(
    (nodeData: FolderItem) => {
      return generateTitle(context, nodeData, setFolderIdForEditModal);
    },
    [context, setFolderIdForEditModal],
  );

  const onDrop = useCallback(
    ({
      node,
      dragNode,
      dropToGap,
    }: {
      node: FolderItem | null;
      dragNode: FolderItem;
      dropToGap: boolean;
    }) => {
      // Node is the node onto which dragNode is dropped
      if (node == null) {
        return;
      }

      function moveIfAllowed(sourceId: string, targetId: string) {
        const sourceAllowed = itemByIdRef.current[sourceId]?.isEditable ?? false;
        const targetAllowed = itemByIdRef.current[targetId]?.isEditable ?? false;
        if (sourceAllowed && targetAllowed) {
          context.queries.moveFolderMutation.mutateAsync([sourceId, targetId]);
        } else {
          Toast.warning(
            `You don't have the necessary permissions to move this folder${
              sourceAllowed ? " to the specified target" : ""
            }.`,
          );
        }
      }

      if (dropToGap && node.parent) {
        // dragNode was dragged *next to* node. Move into parent.
        moveIfAllowed(dragNode.key, node.parent);
      } else {
        // dragNode was dragged *into* node
        moveIfAllowed(dragNode.key, node.key);
      }
    },
    [context],
  );

  return (
    <div>
      <div
        ref={drop}
        className={isDraggingDataset ? "highlight-folder-sidebar" : ""}
        style={{
          height: 400,
          marginRight: 4,
          borderRadius: 2,
          paddingLeft: 6,
          paddingRight: 6,
          paddingTop: 2,
          maxWidth: "20vw",
        }}
      >
        {!isLoading && treeData.length === 0 ? (
          <div style={{ textAlign: "center" }}>
            No folders available.
            <br /> Ask an administrator to grant you access.
          </div>
        ) : null}
        <DirectoryTree
          autoExpandParent
          blockNode
          expandAction="doubleClick"
          selectedKeys={nullableIdToArray(context.activeFolderId)}
          draggable={isDraggingDataset ? false : draggableConfig}
          defaultExpandAll
          onSelect={onSelect}
          onExpand={onExpand}
          treeData={treeData}
          titleRender={titleRender}
          onDrop={onDrop}
          expandedKeys={expandedKeys}
        />
      </div>
    </div>
  );
}

export function getFolderHierarchy(
  folderTree: FlatFolderTreeItem[] | undefined,
  prevExpandedKeys: string[],
  activeFolderId: string | null,
): [FolderItem[], string[], Record<string, FolderItem>] {
  if (folderTree == null) {
    return [[], prevExpandedKeys, {}];
  }
  const roots: FolderItem[] = [];
  const itemById: Record<string, FolderItem> = {};
  for (const folderTreeItem of folderTree) {
    const treeItem = {
      key: folderTreeItem.id,
      title: folderTreeItem.name,
      isEditable: folderTreeItem.isEditable,
      parent: folderTreeItem.parent,
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

  const newExpandedKeySet = new Set<string>();
  if (roots.length > 0) {
    newExpandedKeySet.add(roots[0].key);
  }

  for (const oldExpandedKey of prevExpandedKeys) {
    const maybeItem = itemById[oldExpandedKey];
    if (maybeItem != null) {
      newExpandedKeySet.add(oldExpandedKey);
    }
  }

  // Expand the parent chain of the active folder.
  if (activeFolderId != null) {
    let currentFolder = itemById[activeFolderId];
    while (currentFolder?.parent != null) {
      newExpandedKeySet.add(currentFolder.parent as string);
      currentFolder = itemById[currentFolder.parent];
    }
  }

  return [roots, Array.from(newExpandedKeySet), itemById];
}

function generateTitle(
  context: DatasetCollectionContextValue,
  folder: FolderItem,
  setFolderIdForEditModal: (folderId: string) => void,
) {
  const { key: id, title, isEditable } = folder;

  function createFolder(): void {
    const folderName = prompt("Please input a name for the new folder", "New folder");
    if (!folderName) {
      // The user hit escape/cancel
      return;
    }
    context.queries.createFolderMutation.mutateAsync([id, folderName]);
  }
  function deleteFolder(): void {
    context.queries.deleteFolderMutation.mutateAsync(id);
  }

  function editFolder(): void {
    setFolderIdForEditModal(id);
  }

  const createMenu = () => (
    <Menu>
      <Menu.Item
        key="create"
        data-group-id={id}
        onClick={createFolder}
        disabled={!folder.isEditable}
      >
        <PlusOutlined />
        New Folder
      </Menu.Item>
      <Menu.Item key="edit" data-group-id={id} onClick={editFolder} disabled={!folder.isEditable}>
        <EditOutlined />
        Edit Folder
      </Menu.Item>

      <Menu.Item
        key="delete"
        data-group-id={id}
        onClick={deleteFolder}
        disabled={!folder.isEditable}
      >
        <DeleteOutlined />
        Delete Folder
      </Menu.Item>
    </Menu>
  );

  return (
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
      <FolderItemAsDropTarget folderId={id} isEditable={isEditable}>
        {title}
      </FolderItemAsDropTarget>
    </Dropdown>
  );
}

function FolderItemAsDropTarget(props: {
  folderId: string;
  children: React.ReactNode;
  className?: string;
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
      className={classNames("folder-item", className, {
        "valid-drop-target": isOver && canDrop,
      })}
      ref={drop}
      style={{ cursor: "pointer" }}
      {...restProps}
    >
      {props.children}
    </div>
  );
}

function _nullableIdToArray(activeFolderId: string | null): string[] {
  return activeFolderId != null ? [activeFolderId] : [];
}

const nullableIdToArray = memoizeOne(_nullableIdToArray);
