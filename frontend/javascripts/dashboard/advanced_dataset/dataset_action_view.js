// @flow
import { Tooltip } from "antd";
import {
  EllipsisOutlined,
  EyeOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  PlusCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Link, withRouter } from "react-router-dom";
import * as React from "react";
import { Unicode } from "oxalis/constants";

import type { APIMaybeUnimportedDataset, APIDatasetId } from "types/api_flow_types";
import { clearCache } from "admin/admin_rest_api";
import { doesSupportVolumeWithFallback } from "oxalis/model/accessors/dataset_accessor";
import Toast from "libs/toast";
import messages from "messages";

import CreateExplorativeModal from "dashboard/advanced_dataset/create_explorative_modal";

const disabledStyle = { pointerEvents: "none", color: "var(--ant-disabled)" };
function getDisabledWhenReloadingStyle(isReloading) {
  return isReloading ? disabledStyle : null;
}

function NewAnnotationLink({
  dataset,
  isReloading,
  isCreateExplorativeModalVisible,
  onShowCreateExplorativeModal,
  onCloseCreateExplorativeModal,
}) {
  const withFallback = doesSupportVolumeWithFallback(dataset) ? "true" : "false";

  return (
    <React.Fragment>
      {isReloading ? null : (
        <div>
          <LinkWithDisabled
            to={`/datasets/${dataset.owningOrganization}/${
              dataset.name
            }/createExplorative/hybrid/${withFallback}`}
            style={{ display: "inline-block" }}
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
            onClick={onShowCreateExplorativeModal}
          >
            <EllipsisOutlined style={{ color: "var(--ant-link)" }} />
          </a>
          {isCreateExplorativeModalVisible ? (
            <CreateExplorativeModal datasetId={dataset} onClose={onCloseCreateExplorativeModal} />
          ) : null}
        </div>
      )}
    </React.Fragment>
  );
}

type Props = {
  dataset: APIMaybeUnimportedDataset,
  updateDataset: APIDatasetId => Promise<void>,
};

type State = {
  isReloading: boolean,
  isCreateExplorativeModalVisible: boolean,
};

function LinkWithDisabled({
  disabled,
  onClick,
  ...rest
}: {
  disabled?: boolean,
  onClick?: () => void,
  style?: Object,
  to: string,
}) {
  const maybeDisabledStyle = disabled ? disabledStyle : null;
  const adaptedStyle =
    rest.style != null
      ? {
          ...rest.style,
          ...maybeDisabledStyle,
        }
      : maybeDisabledStyle;
  if (!onClick) {
    onClick = () => {};
  }

  return (
    <Link {...rest} style={adaptedStyle} onClick={e => (disabled ? e.preventDefault() : onClick)} />
  );
}

class DatasetActionView extends React.PureComponent<Props, State> {
  state = {
    isReloading: false,
    isCreateExplorativeModalVisible: false,
  };

  clearCache = async (dataset: APIMaybeUnimportedDataset) => {
    this.setState({ isReloading: true });
    await clearCache(dataset);
    await this.props.updateDataset(dataset);
    Toast.success(
      messages["dataset.clear_cache_success"]({
        datasetName: dataset.name,
      }),
    );
    this.setState({ isReloading: false });
  };

  render() {
    const { dataset } = this.props;
    const { isReloading } = this.state;
    const { isCreateExplorativeModalVisible } = this.state;

    const disabledWhenReloadingStyle = getDisabledWhenReloadingStyle(isReloading);

    const reloadLink = !dataset.isForeign ? (
      <a
        onClick={() => this.clearCache(dataset)}
        title="Reload Dataset"
        style={disabledWhenReloadingStyle}
        type="link"
      >
        {isReloading ? <LoadingOutlined /> : <ReloadOutlined />}
        Reload
      </a>
    ) : null;

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
        <div className="text-danger">{dataset.dataSource.status}</div>
      </div>
    );

    return (
      <div>
        {dataset.isEditable && !dataset.isActive ? importLink : null}
        {dataset.isActive ? (
          <div className="dataset-actions nowrap">
            {!dataset.isForeign ? (
              <NewAnnotationLink
                dataset={dataset}
                isReloading={isReloading}
                isCreateExplorativeModalVisible={isCreateExplorativeModalVisible}
                onShowCreateExplorativeModal={() =>
                  this.setState({ isCreateExplorativeModalVisible: true })
                }
                onCloseCreateExplorativeModal={() =>
                  this.setState({ isCreateExplorativeModalVisible: false })
                }
              />
            ) : (
              <p style={disabledWhenReloadingStyle}>
                New Annotation {Unicode.NonBreakingSpace}
                <Tooltip title="Cannot create annotations for read-only datasets">
                  <InfoCircleOutlined style={{ color: "gray" }} />
                </Tooltip>
              </p>
            )}
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

export default withRouter(DatasetActionView);
