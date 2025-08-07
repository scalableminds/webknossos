import {
  DeleteOutlined,
  EllipsisOutlined,
  EyeOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import { clearCache, deleteDatasetOnDisk, getDataset } from "admin/rest_api";
import { type MenuProps, Modal, Typography } from "antd";
import CreateExplorativeModal from "dashboard/advanced_dataset/create_explorative_modal";
import { confirmAsync } from "dashboard/dataset/helper_components";
import Toast from "libs/toast";
import window from "libs/window";
import messages from "messages";
import type * as React from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { APIDataset, APIDatasetCompact } from "types/api_types";
import { getReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import { getNoActionsAvailableMenu } from "viewer/view/context_menu";

const disabledStyle: React.CSSProperties = {
  pointerEvents: "none",
  color: "var(--ant-color-text-disabled)",
};

function getDisabledWhenReloadingStyle(isReloading: boolean) {
  return isReloading ? disabledStyle : undefined;
}

function NewAnnotationLink({
  dataset,
  isReloading,
  isCreateExplorativeModalVisible,
  onShowCreateExplorativeModal,
  onCloseCreateExplorativeModal,
}: {
  dataset: APIDatasetCompact;
  isReloading: boolean;
  isCreateExplorativeModalVisible: boolean;
  onShowCreateExplorativeModal: () => void;
  onCloseCreateExplorativeModal: () => void;
}) {
  return (
    <div>
      <LinkWithDisabled
        to={`/datasets/${dataset.id}/createExplorative/hybrid?autoFallbackLayer=true`}
        style={{
          display: "inline-block",
        }}
        title="New Annotation (Skeleton + Volume)"
        disabled={isReloading}
      >
        <PlusOutlined className="icon-margin-right" />
        New Annotation
      </LinkWithDisabled>
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
        onClick={() => !isReloading && onShowCreateExplorativeModal()}
      >
        <EllipsisOutlined
          style={{
            color: "var(--ant-color-link)",
          }}
        />
      </a>
      {isCreateExplorativeModalVisible ? (
        <CreateExplorativeModal datasetId={dataset.id} onClose={onCloseCreateExplorativeModal} />
      ) : null}
    </div>
  );
}

type Props = {
  dataset: APIDatasetCompact;
  reloadDataset: (arg0: string) => Promise<void>;
};

function LinkWithDisabled({
  disabled,
  onClick,
  ...rest
}: {
  disabled?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
  to: string;
  children: React.ReactNode;
  title?: string;
}) {
  const maybeDisabledStyle = disabled ? disabledStyle : null;
  const adaptedStyle =
    rest.style != null ? { ...rest.style, ...maybeDisabledStyle } : maybeDisabledStyle;

  if (!onClick) {
    onClick = () => {};
  }

  return (
    <Link
      {...rest}
      style={adaptedStyle || undefined}
      onClick={(e) => (disabled ? e.preventDefault() : onClick?.())}
    />
  );
}

function DatasetActionView(props: Props) {
  const queryClient = useQueryClient();
  const { dataset } = props;

  const [isReloading, setIsReloading] = useState(false);
  const [isCreateExplorativeModalVisible, setIsCreateExplorativeModalVisible] = useState(false);

  const onClearCache = async (compactDataset: APIDatasetCompact) => {
    setIsReloading(true);
    const dataset = await getDataset(compactDataset.id);
    await clearCache(dataset);
    await props.reloadDataset(dataset.id);
    Toast.success(
      messages["dataset.clear_cache_success"]({
        datasetName: dataset.name,
      }),
    );
    setIsReloading(false);
  };

  const onDeleteDataset = async () => {
    const dataset = await getDataset(props.dataset.id);

    const deleteDataset = await confirmAsync({
      title: "Danger Zone",
      content: (
        <>
          <Typography.Title level={4} type="danger">
            Deleting a dataset from disk cannot be undone. Are you certain to delete dataset{" "}
            {dataset.name}?
          </Typography.Title>
          <Typography.Paragraph>
            Note, WEBKNOSSOS cannot delete datasets that have annotations associated with them.
          </Typography.Paragraph>
        </>
      ),
      okText: "Yes, delete dataset from disk",
      okType: "danger",
    });

    if (!deleteDataset) {
      return;
    }

    await deleteDatasetOnDisk(dataset.dataStore.url, dataset.id);

    Toast.success(
      messages["dataset.delete_success"]({
        datasetName: dataset.name,
      }),
    );

    // Invalidate the dataset list cache to exclude the deleted dataset
    queryClient.setQueryData(
      ["datasetsByFolder", dataset.folderId],
      (oldItems: APIDatasetCompact[] | undefined) => {
        if (oldItems == null) {
          return oldItems;
        }
        return oldItems.filter((item) => item.id !== dataset.id);
      },
    );
    queryClient.invalidateQueries({ queryKey: ["dataset", "search"] });
  };

  const disabledWhenReloadingStyle = getDisabledWhenReloadingStyle(isReloading);
  const reloadLink = (
    <a
      onClick={() => onClearCache(dataset)}
      title="Reload Dataset"
      style={disabledWhenReloadingStyle}
      type="link"
    >
      {isReloading ? (
        <LoadingOutlined className="icon-margin-right" />
      ) : (
        <ReloadOutlined className="icon-margin-right" />
      )}
      Reload
    </a>
  );
  const datasetSettingsLink = (
    <>
      <LinkWithDisabled
        to={`/datasets/${getReadableURLPart(dataset)}/edit`}
        title="Open Dataset Settings"
        disabled={isReloading}
      >
        <SettingOutlined className="icon-margin-right" />
        Settings
      </LinkWithDisabled>
    </>
  );
  const brokenDatasetActions = (
    <div className="dataset-table-actions">
      <Link to={`/datasets/${getReadableURLPart(dataset)}/edit`}>
        <SettingOutlined className="icon-margin-right" />
        Settings
      </Link>
      {reloadLink}
      <a
        onClick={() =>
          Modal.error({
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
      {dataset.status !== "Deleted by user." ? (
        <a onClick={() => onDeleteDataset()}>
          <DeleteOutlined className="icon-margin-right" />
          Delete Dataset
        </a>
      ) : null}
    </div>
  );

  const activeDatasetActions = (
    <>
      {" "}
      <NewAnnotationLink
        dataset={dataset}
        isReloading={isReloading}
        isCreateExplorativeModalVisible={isCreateExplorativeModalVisible}
        onShowCreateExplorativeModal={() => setIsCreateExplorativeModalVisible(true)}
        onCloseCreateExplorativeModal={() => setIsCreateExplorativeModalVisible(false)}
      />
      <LinkWithDisabled
        to={`/datasets/${getReadableURLPart(dataset)}/view`}
        title="View Dataset"
        disabled={isReloading}
      >
        <EyeOutlined className="icon-margin-right" />
        View
      </LinkWithDisabled>
      {dataset.isEditable ? datasetSettingsLink : null}
      {reloadLink}
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
const onClearCache = async (
  dataset: APIDataset,
  reloadDataset: (arg0: string) => Promise<void>,
) => {
  await clearCache(dataset);
  await reloadDataset(dataset.id);
  Toast.success(
    messages["dataset.clear_cache_success"]({
      datasetName: dataset.name,
    }),
  );
};

export function getDatasetActionContextMenu({
  reloadDataset,
  datasets,
  hideContextMenu,
}: {
  reloadDataset: (arg0: string) => Promise<void>;
  datasets: APIDatasetCompact[];
  hideContextMenu: () => void;
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
      dataset.isActive
        ? {
            key: "view",
            label: "View",
            onClick: () => {
              window.location.href = `/datasets/${getReadableURLPart(dataset)}/view`;
            },
          }
        : null,
      dataset.isEditable
        ? {
            key: "edit",
            label: "Open Settings",
            onClick: () => {
              window.location.href = `/datasets/${getReadableURLPart(dataset)}/edit`;
            },
          }
        : null,

      {
        key: "reload",
        label: "Reload",
        onClick: async () => {
          const fullDataset = await getDataset(dataset.id);
          return dataset.isActive ? onClearCache(fullDataset, reloadDataset) : null;
        },
      },
    ],
  };
}

export default DatasetActionView;
