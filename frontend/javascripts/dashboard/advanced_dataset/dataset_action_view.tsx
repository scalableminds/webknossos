import {
  CopyOutlined,
  EllipsisOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { App, type MenuProps } from "antd";
import type { useAppProps } from "antd/es/app/context";
import { applyViewConfigurationToDatasetsInFolder } from "dashboard/advanced_dataset/apply_view_configuration";
import CreateAnnotationModal from "dashboard/advanced_dataset/create_annotation_modal";
import { useDatasetCollectionContext } from "dashboard/dataset/dataset_collection_context";
import Toast from "libs/toast";
import window from "libs/window";
import messages from "messages";
import { useState } from "react";
import { Link } from "react-router";
import type { APIDatasetCompact } from "types/api_types";
import { getReadableURLPart, getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import { getNoActionsAvailableMenu } from "viewer/view/context_menu/helpers";

function ResumeAnnotationLink({ latestAnnotationId }: { latestAnnotationId: string }) {
  return (
    <Link
      to={`/annotations/${latestAnnotationId}`}
      title="Resume Your Most Recently Modified Annotation of this Dataset"
    >
      <PlayCircleOutlined className="icon-margin-right" />
      Resume Annotating
    </Link>
  );
}

function NewAnnotationLink({
  dataset,
  isCreateAnnotationModalVisible,
  onShowCreateAnnotationModal,
  onCloseCreateAnnotationModal,
}: {
  dataset: APIDatasetCompact;
  isCreateAnnotationModalVisible: boolean;
  onShowCreateAnnotationModal: () => void;
  onCloseCreateAnnotationModal: () => void;
}) {
  return (
    <div>
      <Link
        to={`/datasets/${dataset.id}/createExplorative/hybrid?autoFallbackLayer=true`}
        style={{
          display: "inline-block",
        }}
        title="Start a New Annotation (Skeleton + Volume)"
      >
        <PlusOutlined className="icon-margin-right" />
        Start New Annotation
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
        title="Start a New Annotation With Custom Properties"
        className="ant-dropdown-link"
        onClick={onShowCreateAnnotationModal}
      >
        <EllipsisOutlined />
      </a>
      {isCreateAnnotationModalVisible ? (
        <CreateAnnotationModal datasetId={dataset.id} onClose={onCloseCreateAnnotationModal} />
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

  const [isCreateAnnotationModalVisible, setIsCreateAnnotationModalVisible] = useState(false);

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
      {dataset.latestAnnotationId != null ? (
        <ResumeAnnotationLink latestAnnotationId={dataset.latestAnnotationId} />
      ) : null}
      <NewAnnotationLink
        dataset={dataset}
        isCreateAnnotationModalVisible={isCreateAnnotationModalVisible}
        onShowCreateAnnotationModal={() => setIsCreateAnnotationModalVisible(true)}
        onCloseCreateAnnotationModal={() => setIsCreateAnnotationModalVisible(false)}
      />
      <Link to={getViewDatasetURL(dataset)} title="Open Dataset in Viewer (Read-only)">
        <EyeOutlined className="icon-margin-right" />
        Open in Viewer
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
          dataset.isActive && dataset.latestAnnotationId != null
            ? {
                key: "resume-annotation",
                icon: <PlayCircleOutlined className="icon-margin-right" />,
                label: "Resume Annotating",
                onClick: () => {
                  window.location.href = `/annotations/${dataset.latestAnnotationId}`;
                },
              }
            : null,
          dataset.isActive
            ? {
                key: "view",
                icon: <EyeOutlined className="icon-margin-right" />,
                label: "Open in Viewer",
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
