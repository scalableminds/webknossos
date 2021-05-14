// @flow
import { Dropdown, Menu, Tooltip } from "antd";
import {
  DownOutlined,
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

import type { APIMaybeUnimportedDataset, APIDataset, APIDatasetId } from "types/api_flow_types";
import { clearCache, sendAnalyticsEvent } from "admin/admin_rest_api";
import {
  getSegmentationLayer,
  doesSupportVolumeWithFallback,
} from "oxalis/model/accessors/dataset_accessor";
import Toast from "libs/toast";
import messages from "messages";

const getNewTracingMenu = (maybeUnimportedDataset: APIMaybeUnimportedDataset) => {
  if (!maybeUnimportedDataset.isActive) {
    // The dataset isn't imported. This menu won't be shown, anyway.
    return <Menu />;
  }
  const dataset: APIDataset = maybeUnimportedDataset;

  const buildMenuItem = (type, useFallback, label, disabled = false) => {
    const typeCapitalized = type.charAt(0).toUpperCase() + type.slice(1);
    return (
      <Menu.Item key="existing">
        <LinkWithDisabled
          to={`/datasets/${dataset.owningOrganization}/${dataset.name}/createExplorative/${type}/${
            useFallback ? "true" : "false"
          }`}
          title={`New ${typeCapitalized} Annotation`}
          disabled={disabled}
        >
          {label}
        </LinkWithDisabled>
      </Menu.Item>
    );
  };

  const segmentationLayer = getSegmentationLayer(dataset);

  if (segmentationLayer != null) {
    if (doesSupportVolumeWithFallback(dataset)) {
      return (
        <Menu>
          <Menu.ItemGroup title="Other Options:" />
          {buildMenuItem("hybrid", false, "New Annotation (Without Existing Segmentation)")}
          {buildMenuItem("skeleton", false, "New Skeleton-only Annotation")}
          <Menu.SubMenu title="New Volume-only Annotation">
            {buildMenuItem("volume", true, "With Existing Segmentation")}
            {buildMenuItem("volume", false, "Without Existing Segmentation")}
          </Menu.SubMenu>
        </Menu>
      );
    } else {
      return (
        <Menu>
          <Menu.ItemGroup title="Other Options:" />
          {buildMenuItem("skeleton", false, "New Skeleton-only Annotation")}
          <Menu.SubMenu title="New Volume-only Annotation">
            {buildMenuItem("volume", true, "With existing Segmentation", true)}
            {buildMenuItem("volume", false, "Without Existing Segmentation")}
          </Menu.SubMenu>
        </Menu>
      );
    }
  } else {
    return (
      <Menu>
        <Menu.ItemGroup title="Other Options:" />
        {buildMenuItem("skeleton", false, "New Skeleton-only Annotation")}
        {buildMenuItem("volume", true, "New Volume-only Annotation")}
      </Menu>
    );
  }
};

const disabledStyle = { pointerEvents: "none", color: "rgba(0, 0, 0, 0.25)" };
function getDisabledWhenReloadingStyle(isReloading) {
  return isReloading ? disabledStyle : null;
}

function NewAnnotationLink({ dataset, isReloading }) {
  const newTracingMenu = getNewTracingMenu(dataset);
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
              color: "#abadaf",
              marginLeft: 8,
              marginRight: 8,
            }}
          >
            |
          </span>
          <Dropdown overlay={newTracingMenu}>
            <a className="ant-dropdown-link" onClick={e => e.preventDefault()}>
              <DownOutlined style={{ color: "#56a1e7" }} />
            </a>
          </Dropdown>
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
              <NewAnnotationLink dataset={dataset} isReloading={isReloading} />
            ) : (
              <p style={disabledWhenReloadingStyle}>
                New Annotation &nbsp;
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
                  onClick={() =>
                    sendAnalyticsEvent("open_dataset_settings", { datasetName: dataset.name })
                  }
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
