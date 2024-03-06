import {
  EllipsisOutlined,
  EyeOutlined,
  LoadingOutlined,
  PlusCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import window from "libs/window";
import { Link, LinkProps, RouteComponentProps, withRouter } from "react-router-dom";
import * as React from "react";
import type { APIDatasetId, APIDataset, APIDatasetCompact } from "types/api_flow_types";
import { clearCache, getDataset } from "admin/admin_rest_api";
import Toast from "libs/toast";
import messages from "messages";
import CreateExplorativeModal from "dashboard/advanced_dataset/create_explorative_modal";
import { MenuProps, Modal } from "antd";

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
        to={`/datasets/${dataset.owningOrganization}/${dataset.name}/createExplorative/hybrid?autoFallbackLayer=true`}
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
        <CreateExplorativeModal datasetId={dataset} onClose={onCloseCreateExplorativeModal} />
      ) : null}
    </div>
  );
}

type Props = {
  dataset: APIDatasetCompact;
  reloadDataset: (arg0: APIDatasetId) => Promise<void>;
};
type State = {
  isReloading: boolean;
  isCreateExplorativeModalVisible: boolean;
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
} & LinkProps) {
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
      onClick={(e) => (disabled ? e.preventDefault() : onClick)}
    />
  );
}

class DatasetActionView extends React.PureComponent<Props, State> {
  state = {
    isReloading: false,
    isCreateExplorativeModalVisible: false,
  };

  onClearCache = async (compactDataset: APIDatasetCompact) => {
    this.setState({
      isReloading: true,
    });
    const dataset = await getDataset(compactDataset);
    await clearCache(dataset);
    await this.props.reloadDataset(dataset);
    Toast.success(
      messages["dataset.clear_cache_success"]({
        datasetName: dataset.name,
      }),
    );
    this.setState({
      isReloading: false,
    });
  };

  render() {
    const { dataset } = this.props;
    const { isReloading } = this.state;
    const { isCreateExplorativeModalVisible } = this.state;
    const disabledWhenReloadingStyle = getDisabledWhenReloadingStyle(isReloading);
    const reloadLink = (
      <a
        onClick={() => this.onClearCache(dataset)}
        title="Reload Dataset"
        style={disabledWhenReloadingStyle}
        type="link"
      >
        {isReloading ? <LoadingOutlined /> : <ReloadOutlined className="icon-margin-right" />}
        Reload
      </a>
    );
    const importLink = (
      <div className="dataset-table-actions">
        <Link
          to={`/datasets/${dataset.owningOrganization}/${dataset.name}/import`}
          className="import-dataset"
        >
          <PlusCircleOutlined className="icon-margin-right" />
          Import
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
                      Even though this dataset was deleted by a user, it is still shown here,
                      because it was referenced by at least one annotation.
                    </p>
                  ) : null}
                </div>
              ),
            })
          }
        >
          <WarningOutlined className="icon-margin-right"/>
          Show Error
        </a>
      </div>
    );
    return (
      <div>
        {dataset.isEditable && !dataset.isActive ? importLink : null}
        {dataset.isActive ? (
          <div className="dataset-table-actions nowrap">
            <NewAnnotationLink
              dataset={dataset}
              isReloading={isReloading}
              isCreateExplorativeModalVisible={isCreateExplorativeModalVisible}
              onShowCreateExplorativeModal={() =>
                this.setState({
                  isCreateExplorativeModalVisible: true,
                })
              }
              onCloseCreateExplorativeModal={() =>
                this.setState({
                  isCreateExplorativeModalVisible: false,
                })
              }
            />
            <LinkWithDisabled
              to={`/datasets/${dataset.owningOrganization}/${dataset.name}/view`}
              title="View Dataset"
              disabled={isReloading}
            >
              <EyeOutlined className="icon-margin-right" />
              View
            </LinkWithDisabled>
            {dataset.isEditable ? (
              <React.Fragment>
                <LinkWithDisabled
                  to={`/datasets/${dataset.owningOrganization}/${dataset.name}/edit`}
                  title="Open Dataset Settings"
                  disabled={isReloading}
                >
                  <SettingOutlined className="icon-margin-right" />
                  Settings
                </LinkWithDisabled>
                {reloadLink}
              </React.Fragment>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
}
const onClearCache = async (
  dataset: APIDataset,
  reloadDataset: (arg0: APIDatasetId) => Promise<void>,
) => {
  await clearCache(dataset);
  await reloadDataset(dataset);
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
  reloadDataset: (arg0: APIDatasetId) => Promise<void>;
  datasets: APIDatasetCompact[];
  hideContextMenu: () => void;
}): MenuProps {
  if (datasets.length !== 1) {
    return {
      onClick: hideContextMenu,
      style: {
        borderRadius: 6,
      },
      mode: "vertical",
      items: [
        {
          key: "view",
          disabled: true,
          label: "No actions available.",
        },
      ],
    };
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
              window.location.href = `/datasets/${dataset.owningOrganization}/${dataset.name}/view`;
            },
          }
        : null,
      dataset.isEditable && dataset.isActive
        ? {
            key: "edit",
            label: "Open Settings",
            onClick: () => {
              window.location.href = `/datasets/${dataset.owningOrganization}/${dataset.name}/edit`;
            },
          }
        : null,

      dataset.isEditable && !dataset.isActive
        ? {
            key: "import",
            label: "Import",
            onClick: () => {
              window.location.href = `/datasets/${dataset.owningOrganization}/${dataset.name}/import`;
            },
          }
        : null,
      {
        key: "reload",
        label: "Reload",
        onClick: async () => {
          const fullDataset = await getDataset(dataset);
          return dataset.isActive ? onClearCache(fullDataset, reloadDataset) : null;
        },
      },
    ],
  };
}

export default withRouter<RouteComponentProps & Props, any>(DatasetActionView);
