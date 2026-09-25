import {
  CopyOutlined,
  EllipsisOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { App, type MenuProps } from "antd";
import type { useAppProps } from "antd/es/app/context";
import { applyViewConfigurationToDatasetsInFolder } from "dashboard/advanced_dataset/apply_view_configuration";
import CreateExplorativeModal from "dashboard/advanced_dataset/create_explorative_modal";
import { useDatasetCollectionContext } from "dashboard/dataset/dataset_collection_context";
import Toast from "libs/toast";
import window from "libs/window";
import messages from "messages";
import { useState } from "react";
import { Link } from "react-router";
import type { APIDatasetCompact } from "types/api_types";
import { getReadableURLPart, getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import { getNoActionsAvailableMenu } from "viewer/view/context_menu/helpers";

function NewAnnotationLink({
  dataset,
  isCreateExplorativeModalVisible,
  onShowCreateExplorativeModal,
  onCloseCreateExplorativeModal,
}: {
  dataset: APIDatasetCompact;
  isCreateExplorativeModalVisible: boolean;
  onShowCreateExplorativeModal: () => void;
  onCloseCreateExplorativeModal: () => void;
}) {
  return (
    <div>
      <Link
        to={`/datasets/${dataset.id}/createExplorative/hybrid?autoFallbackLayer=true`}
        style={{
          display: "inline-block",
        }}
        title="New Annotation (Skeleton + Volume)"
      >
        <PlusOutlined className="icon-margin-right" />
        New Annotation
      </Link>
      <span
        style={{
          marginLeft: 8,
          marginRight: 8,
          color: "var(--ant-color-border)",
        }}
      >
        |
      </span>
      <a
        title="New Annotation With Custom Properties"
        className="ant-dropdown-link"
        onClick={onShowCreateExplorativeModal}
      >
        <EllipsisOutlined />
      </a>
      {isCreateExplorativeModalVisible ? (
        <CreateExplorativeModal datasetId={dataset.id} onClose={onCloseCreateExplorativeModal} />
      ) : null}
    </div>
  );
}

type Props = {
  dataset: APIDatasetCompact;
};

export function useReloadDataset() {
  const context = useDatasetCollectionContext();
  const [isReloading, setIsReloading] = useState(false);

  const reloadDataset = async (datasetId: string) => {
    setIsReloading(true);
    try {
      await onReloadImpl(datasetId, context.clearCacheAndReloadDataset);
    } finally {
      setIsReloading(false);
    }
  };

  return { isReloading, reloadDataset };
}

function DatasetActionView(props: Props) {
  const { modal } = App.useApp();
  const { dataset } = props;

  const [isCreateExplorativeModalVisible, setIsCreateExplorativeModalVisible] = useState(false);

  const datasetSettingsLink = (
    <Link to={`/datasets/${getReadableURLPart(dataset)}/edit`} title="Open Dataset Settings">
      <SettingOutlined className="icon-margin-right" />
      Settings
    </Link>
  );
  const brokenDatasetActions = (
    <div className="dataset-table-actions">
      <a
        onClick={() =>
          modal.error({
            title: "Cannot load this dataset",
            content: (
              <div>
                <p>{dataset.status}</p>
                {dataset.status === "Deleted by user." ? (
                  <p>
                    Even though this dataset was deleted by a user, it is still shown here, because
                    it was referenced by at least one annotation.
                  </p>
                ) : null}
              </div>
            ),
          })
        }
      >
        <WarningOutlined className="icon-margin-right" />
        Show Error
      </a>
    </div>
  );

  const activeDatasetActions = (
    <>
      {" "}
      <NewAnnotationLink
        dataset={dataset}
        isCreateExplorativeModalVisible={isCreateExplorativeModalVisible}
        onShowCreateExplorativeModal={() => setIsCreateExplorativeModalVisible(true)}
        onCloseCreateExplorativeModal={() => setIsCreateExplorativeModalVisible(false)}
      />
      <Link to={getViewDatasetURL(dataset)} title="View Dataset">
        <EyeOutlined className="icon-margin-right" />
        View
      </Link>
      {dataset.isEditable ? datasetSettingsLink : null}
    </>
  );
  return (
    <div>
      {dataset.isEditable && !dataset.isActive ? brokenDatasetActions : null}
      <div className="dataset-table-actions nowrap">
        {dataset.isActive ? activeDatasetActions : null}
      </div>
    </div>
  );
}
const onReloadImpl = async (
  datasetId: string,
  clearCacheAndReloadDataset: (arg0: string) => Promise<void>,
) => {
  await clearCacheAndReloadDataset(datasetId);
  Toast.success(messages["dataset.clear_cache_success"]);
};

export function getDatasetActionContextMenu({
  clearCacheAndReloadDataset,
  datasets,
  hideContextMenu,
  modal,
}: {
  clearCacheAndReloadDataset: (arg0: string) => Promise<void>;
  datasets: APIDatasetCompact[];
  hideContextMenu: () => void;
  modal: useAppProps["modal"];
}): MenuProps {
  if (datasets.length !== 1) {
    return getNoActionsAvailableMenu(hideContextMenu);
  }
  const dataset = datasets[0];

  return {
    onClick: hideContextMenu,
    style: {
      borderRadius: 6,
    },
    mode: "vertical",
    items: [
      {
        key: "dataset-group",
        type: "group",
        label: "This Dataset",
        children: [
          dataset.isActive
            ? {
                key: "view",
                icon: <EyeOutlined className="icon-margin-right" />,
                label: "View",
                onClick: () => {
                  window.location.href = getViewDatasetURL(dataset);
                },
              }
            : null,
          dataset.isActive && dataset.isEditable
            ? {
                key: "edit",
                icon: <SettingOutlined className="icon-margin-right" />,
                label: "Open Settings",
                onClick: () => {
                  window.location.href = `/datasets/${getReadableURLPart(dataset)}/edit`;
                },
              }
            : null,
          {
            key: "reload",
            icon: <ReloadOutlined className="icon-margin-right" />,
            label: "Reload",
            onClick: async () => onReloadImpl(dataset.id, clearCacheAndReloadDataset),
          },
        ],
      },
      // The following menu entry mutates all other datasets in the folder (and not the clicked one).
      // Strictly speaking, the permission check would need to verify that at least one
      // of these datasets can be edited by the current user.
      // However, as a heuristic, we just check whether the current dataset is editable (by the
      // current user). Thus, a user with no edit rights anywhere won't see this entry at all.
      ...(dataset.isEditable && dataset.isActive
        ? ([
            { key: "whole-folder-divider", type: "divider" },
            {
              key: "folder-group",
              type: "group",
              label: "Whole Folder",
              children: [
                {
                  key: "apply-view-configuration",
                  icon: <CopyOutlined className="icon-margin-right" />,
                  label: "Apply View Configuration to All Datasets in this Folder",
                  onClick: () => applyViewConfigurationToDatasetsInFolder(dataset, modal),
                },
              ],
            },
          ] as NonNullable<MenuProps["items"]>)
        : []),
    ],
  };
}

export default DatasetActionView;
