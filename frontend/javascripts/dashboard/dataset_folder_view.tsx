import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { useIsMutating } from "@tanstack/react-query";
import { Menu, Dropdown, Spin } from "antd";
import Toast from "libs/toast";
import { DatasetExtentRow } from "oxalis/view/right-border-tabs/dataset_info_tab_view";
import { GenerateNodePropsType } from "oxalis/view/right-border-tabs/tree_hierarchy_view";
import React, { useContext, useEffect, useState } from "react";
import { DragObjectWithType, DropTargetMonitor, useDrop } from "react-dnd";
import SortableTree, {
  ExtendedNodeData,
  FullTree,
  NodeData,
  OnDragPreviousAndNextLocation,
  OnMovePreviousAndNextLocation,
} from "react-sortable-tree";
// @ts-ignore
import FileExplorerTheme from "react-sortable-tree-theme-file-explorer";

import { APIUser, FlatFolderTreeItem, APIMaybeUnimportedDataset } from "types/api_flow_types";
import {
  DatasetLayerTags,
  DatasetTags,
  DraggableType,
  TeamTags,
} from "./advanced_dataset/dataset_table";
import DatasetCollectionContextProvider, {
  DatasetCollectionContext,
} from "./dataset/dataset_collection_context";

import DatasetView from "./dataset_view";

type Props = {
  user: APIUser;
};

export function DatasetFolderView(props: Props) {
  return (
    <DatasetCollectionContextProvider>
      <DatasetFolderViewInner {...props} />
    </DatasetCollectionContextProvider>
  );
}

function DatasetFolderViewInner(props: Props) {
  const [selectedDataset, setSelectedDataset] = useState<APIMaybeUnimportedDataset | null>(null);
  const context = useContext(DatasetCollectionContext);
  const isMutating = useIsMutating() > 0;

  console.log("context.datasets", context.datasets);

  return (
    <div
      style={{
        display: "grid",
        gridTemplate: "auto 1fr auto / auto 1fr auto",
      }}
    >
      <div
        style={{
          gridColumn: "1 / 2",
          overflow: "auto",
          borderRight: "1px solid var(--ant-border-base)",
          marginRight: 4,
        }}
      >
        <FolderSidebar />
      </div>
      <main style={{ gridColumn: "2 / 2", overflow: "auto" }}>
        <Spin spinning={context.isLoading || isMutating}>
          <DatasetView
            user={props.user}
            onSelectDataset={setSelectedDataset}
            selectedDataset={selectedDataset}
            context={context}
            hideDetailsColumns
          />
        </Spin>
      </main>
      <div
        style={{
          gridColumn: "3 / 4",
          overflow: "auto",
          borderLeft: "1px solid var(--ant-border-base)",
          marginLeft: 4,
        }}
      >
        <DatasetDetailsSidebar selectedDataset={selectedDataset} />
      </div>
    </div>
  );
}

function DatasetDetailsSidebar({
  selectedDataset,
}: {
  selectedDataset: APIMaybeUnimportedDataset | null;
}) {
  const context = useContext(DatasetCollectionContext);

  // allowedTeams: Array<APITeam>;
  // created: number;
  // description: string | null | undefined;
  // isPublic: boolean;

  // owningOrganization: string;
  // publication: null | undefined;
  // tags: Array<string>;

  return (
    <div style={{ width: 300, padding: 16 }}>
      {selectedDataset != null ? (
        <>
          <h1 style={{ wordBreak: "break-all" }}>
            {selectedDataset.displayName || selectedDataset.name}
          </h1>
          Description: {selectedDataset.description}
          {selectedDataset.isActive && (
            <div className="info-tab-block">
              <table
                style={{
                  fontSize: 14,
                }}
              >
                <tbody>
                  <DatasetExtentRow dataset={selectedDataset} />
                </tbody>
              </table>
            </div>
          )}
          <div>
            Access Permissions: <TeamTags dataset={selectedDataset} emptyValue="default" />
          </div>
          <div>
            Layers: <DatasetLayerTags dataset={selectedDataset} />
          </div>
          {selectedDataset.isActive ? (
            <div>
              Tags:
              <DatasetTags dataset={selectedDataset} updateDataset={context.updateCachedDataset} />
            </div>
          ) : null}
        </>
      ) : (
        "No dataset selected"
      )}
    </div>
  );
}

type FolderItem = {
  title: string;
  id: string;
  expanded?: boolean;
  children: FolderItem[];
};

type State = {
  treeData: FolderItem[];
};

function generateNodeProps(
  context: DatasetCollectionContext,
  params: ExtendedNodeData<FolderItem>,
): GenerateNodePropsType {
  const { node } = params;
  const { id, title } = node;
  const nodeProps: GenerateNodePropsType = {};

  function createFolder(): void {
    const folderName = prompt("Please input a name for the new folder");
    context.queries.createFolderMutation.mutateAsync([id, folderName || "New folder"]);
  }
  function deleteFolder(): void {
    context.queries.deleteFolderMutation.mutateAsync(id);
  }
  function renameFolder(): void {
    const folderName = prompt("Please input a new name for the folder", title);
    context.queries.updateFolderMutation.mutateAsync({
      name: folderName || "New folder",
      id,
      teams: [], // todo
    });
  }

  const createMenu = () => (
    <Menu>
      <Menu.Item key="create" data-group-id={id} onClick={createFolder}>
        <PlusOutlined />
        New Folder
      </Menu.Item>
      <Menu.Item key="rename" data-group-id={id} onClick={renameFolder}>
        <EditOutlined />
        Rename Folder
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
        <FolderItemAsDropTarget onClick={() => context.setActiveFolderId(id)} folderId={id}>
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
}) {
  const context = useContext(DatasetCollectionContext);
  const { folderId, className, ...restProps } = props;

  const [collectedProps, drop] = useDrop({
    accept: DraggableType,
    drop: (item: DragObjectWithType & { datasetName: string }) => {
      const dataset = context.datasets.find((dataset) => dataset.name === item.datasetName);

      if (dataset) {
        context.queries.updateDatasetMutation.mutateAsync([dataset, folderId]);
      } else {
        Toast.error("Could not move dataset. Please try again.");
      }
    },
    collect: (monitor: DropTargetMonitor) => {
      return {
        canDrop: monitor.canDrop(),
        isOver: monitor.isOver(),
      };
    },
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

function FolderSidebar() {
  const [state, setState] = useState<State>({
    treeData: [],
  });
  const context = useContext(DatasetCollectionContext);

  const { data: folderTree } = context.queries.folderTreeQuery;

  useEffect(() => {
    setState((prevState: State) => {
      const treeData = getFolderHierarchy(folderTree, prevState.treeData);
      if (treeData.length > 0 && context.activeFolderId == null) {
        context.setActiveFolderId(treeData[0].id);
      }
      return { treeData: treeData };
    });
  }, [folderTree]);

  const [isDraggingDataset, drop] = useDrop({
    accept: DraggableType,
    collect: (monitor: DropTargetMonitor) => {
      return monitor.canDrop();
    },
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
    return params.nextParent != null;
  };

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
        treeData={state.treeData}
        onChange={(treeData: FolderItem[]) => {
          setState({ treeData });
        }}
        onMoveNode={onMoveNode}
        theme={FileExplorerTheme}
        canDrag={true}
        canDrop={canDropFolder}
        generateNodeProps={(params) =>
          // @ts-ignore
          generateNodeProps(context, params as ExtendedNodeData<FolderItem>)
        }
      />
    </div>
  );
}

function getFolderHierarchy(
  folderTree: FlatFolderTreeItem[] | undefined,
  prevFolderItems: FolderItem[] | null,
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
