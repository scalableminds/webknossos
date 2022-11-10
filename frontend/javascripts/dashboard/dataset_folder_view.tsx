import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { useIsMutating } from "@tanstack/react-query";
import { Menu, Dropdown, Spin, Modal, Input, Form } from "antd";
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

import {
  APIUser,
  FlatFolderTreeItem,
  APIMaybeUnimportedDataset,
  APITeam,
} from "types/api_flow_types";
import {
  DatasetLayerTags,
  DatasetTags,
  DraggableDatasetType,
  TeamTags,
} from "./advanced_dataset/dataset_table";
import DatasetCollectionContextProvider, {
  DatasetCollectionContext,
  DatasetCollectionContextValue,
  useFolderQuery,
} from "./dataset/dataset_collection_context";
import { FormItemWithInfo } from "./dataset/helper_components";
import TeamSelectionComponent from "./dataset/team_selection_component";

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

  useEffect(() => {
    if (!selectedDataset || !context.datasets) {
      return;
    }
    // If the cache changed (e.g., because a dataset was updated), we need to update
    // the selectedDataset instance, too, to avoid that it refers to stale data.
    setSelectedDataset(context.datasets.find((ds) => ds.name === selectedDataset.name) ?? null);
  }, [context.datasets]);

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
          marginRight: 16,
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
          marginLeft: 16,
        }}
      >
        <DatasetDetailsSidebar
          selectedDataset={selectedDataset}
          setSelectedDataset={setSelectedDataset}
        />
      </div>
    </div>
  );
}

function DatasetDetailsSidebar({
  selectedDataset,
  setSelectedDataset,
}: {
  selectedDataset: APIMaybeUnimportedDataset | null;
  setSelectedDataset: (ds: APIMaybeUnimportedDataset | null) => void;
}) {
  const context = useContext(DatasetCollectionContext);

  useEffect(() => {
    if (selectedDataset == null || !("folderId" in selectedDataset)) {
      return;
    }
    if (selectedDataset.folderId !== context.activeFolderId) {
      // Ensure that the selected dataset is in the active folder. If not,
      // clear the sidebar
      setSelectedDataset(null);
    }
  }, [selectedDataset, context.activeFolderId]);

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
        <div style={{ textAlign: "center" }}>No dataset selected</div>
      )}
    </div>
  );
}

type FolderItem = {
  title: string;
  id: string;
  parent: string | null | undefined;
  expanded?: boolean;
  children: FolderItem[];
  isEditable: boolean;
};

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
  const context = useContext(DatasetCollectionContext);
  const { folderId, className, ...restProps } = props;

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
    canDrop: () => props.isEditable,
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

function FolderSidebar() {
  const [treeData, setTreeData] = useState<FolderItem[]>([]);
  const [folderIdForEditModal, setFolderIdForEditModal] = useState<string | null>(null);
  const context = useContext(DatasetCollectionContext);

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
      {folderIdForEditModal != null && (
        <EditFolderModal
          onClose={() => setFolderIdForEditModal(null)}
          folderId={folderIdForEditModal}
        />
      )}
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
    while (currentFolder.parent != null) {
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

function EditFolderModal({ folderId, onClose }: { folderId: string; onClose: () => void }) {
  const { data: folder, isFetching } = useFolderQuery(folderId);
  const [form] = Form.useForm();
  const context = useContext(DatasetCollectionContext);

  const onSave = async () => {
    const name = form.getFieldValue("name");
    const allowedTeams = form.getFieldValue("allowedTeams") as APITeam[];

    if (folder == null) {
      return;
    }

    await context.queries.updateFolderMutation.mutateAsync({
      ...folder,
      id: folderId,
      name,
      allowedTeams: allowedTeams.map((t) => t.id),
    });

    onClose();
  };

  const content =
    // Don't initialize form when isFetching==true, because
    // this would populate the form with outdated initial values.
    folder != null && !isFetching ? (
      <div>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ name: folder.name, allowedTeams: folder.allowedTeams }}
        >
          <FormItemWithInfo name="name" label="Name" info="Name of the folder">
            <Input value={folder.name} />
          </FormItemWithInfo>
          <FormItemWithInfo
            name="allowedTeams"
            label="Allowed Teams"
            info="Teams which may access this folder"
          >
            <TeamSelectionComponent mode="multiple" allowNonEditableTeams />
          </FormItemWithInfo>
        </Form>
      </div>
    ) : (
      <Spin spinning />
    );

  return (
    <Modal title="Edit Folder" visible onOk={onSave} onCancel={onClose}>
      {content}
    </Modal>
  );
}
