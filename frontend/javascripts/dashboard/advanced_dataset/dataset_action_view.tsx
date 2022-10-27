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
import { Link, LinkProps, RouteComponentProps, withRouter } from "react-router-dom";
import * as React from "react";
import type { APIMaybeUnimportedDataset, APIDatasetId, APIDataset } from "types/api_flow_types";
import { clearCache } from "admin/admin_rest_api";
import {
  getFirstSegmentationLayer,
  doesSupportVolumeWithFallback,
} from "oxalis/model/accessors/dataset_accessor";
import Toast from "libs/toast";
import messages from "messages";
import CreateExplorativeModal from "dashboard/advanced_dataset/create_explorative_modal";
import { Modal } from "antd";
const disabledStyle: React.CSSProperties = {
  pointerEvents: "none",
  color: "var(--ant-disabled)",
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
  dataset: APIDataset;
  isReloading: boolean;
  isCreateExplorativeModalVisible: boolean;
  onShowCreateExplorativeModal: () => void;
  onCloseCreateExplorativeModal: () => void;
}) {
  if (isReloading) return null;

  const firstSegmentationLayer = getFirstSegmentationLayer(dataset);
  const supportsFallback = doesSupportVolumeWithFallback(dataset, firstSegmentationLayer)
    ? "true"
    : "false";
  const fallbackLayerGetParameter =
    firstSegmentationLayer != null && supportsFallback
      ? `?fallbackLayerName=${firstSegmentationLayer.name}`
      : "";

  return (
    <div>
      <LinkWithDisabled
        to={`/datasets/${dataset.owningOrganization}/${dataset.name}/createExplorative/hybrid${fallbackLayerGetParameter}`}
        style={
          {
            display: "inline-block",
          } as React.CSSProperties
        }
        title="New Annotation (Skeleton + Volume)"
        disabled={isReloading}
      >
        <PlusOutlined />
        New Annotation
      </LinkWithDisabled>
      <span
        style={{
          marginLeft: 8,
          marginRight: 8,
          color: "var(--ant-border-base)",
        }}
      >
        |
      </span>
      <a
        title="New Annotation With Custom Properties"
        className="ant-dropdown-link"
        onClick={() => onShowCreateExplorativeModal()}
      >
        <EllipsisOutlined
          style={{
            color: "var(--ant-link)",
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
  dataset: APIMaybeUnimportedDataset;
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

  clearCache = async (dataset: APIMaybeUnimportedDataset) => {
    this.setState({
      isReloading: true,
    });
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
        onClick={() => this.clearCache(dataset)}
        title="Reload Dataset"
        style={disabledWhenReloadingStyle}
        type="link"
      >
        {isReloading ? <LoadingOutlined /> : <ReloadOutlined />}
        Reload
      </a>
    );
    const importLink = (
      <div className="dataset-actions">
        <Link
          to={`/datasets/${dataset.owningOrganization}/${dataset.name}/import`}
          className="import-dataset"
        >
          <PlusCircleOutlined />
          Import
        </Link>
        {reloadLink}
        <a
          onClick={() =>
            Modal.error({
              title: "Cannot load this dataset",
              content: dataset.dataSource.status,
            })
          }
        >
          <WarningOutlined />
          Show Error
        </a>
      </div>
    );
    return (
      <div>
        {dataset.isEditable && !dataset.isActive ? importLink : null}
        {dataset.isActive ? (
          <div className="dataset-actions nowrap">
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
              <EyeOutlined />
              View
            </LinkWithDisabled>
            {dataset.isEditable ? (
              <React.Fragment>
                <LinkWithDisabled
                  to={`/datasets/${dataset.owningOrganization}/${dataset.name}/edit`}
                  title="Open Dataset Settings"
                  disabled={isReloading}
                >
                  <SettingOutlined />
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

export default withRouter<RouteComponentProps & Props, any>(DatasetActionView);
