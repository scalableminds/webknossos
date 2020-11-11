// @flow
import { Button, Dropdown, Menu, Icon, Tooltip } from "antd";
import { Link, withRouter } from "react-router-dom";
import * as React from "react";

import type { APIMaybeUnimportedDataset, APIDataset } from "types/api_flow_types";
import { clearCache } from "admin/admin_rest_api";
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
          title={`Create ${typeCapitalized} Annotation`}
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
          {buildMenuItem("hybrid", false, "New Hybrid Annotation (without existing Segmentation)")}
          {buildMenuItem("skeleton", false, "New Skeleton-only Annotation")}
          <Menu.SubMenu title="New Volume-only Annotation">
            {buildMenuItem("volume", true, "with existing Segmentation")}
            {buildMenuItem("volume", false, "without existing Segmentation")}
          </Menu.SubMenu>
        </Menu>
      );
    } else {
      return (
        <Menu>
          {buildMenuItem("skeleton", false, "New Skeleton-only Annotation")}
          <Menu.SubMenu title="New Volume-only Annotation">
            {buildMenuItem("volume", true, "with existing Segmentation", true)}
            {buildMenuItem("volume", false, "without existing Segmentation")}
          </Menu.SubMenu>
        </Menu>
      );
    }
  } else {
    return (
      <Menu>
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
      <LinkWithDisabled
        to={`/datasets/${dataset.owningOrganization}/${
          dataset.name
        }/createExplorative/hybrid/${withFallback}`}
        style={{ display: "inline-block" }}
        title="Create Hybrid Annotation"
        disabled={isReloading}
      >
        <Icon type="swap" />
        New Hybrid Annotation
      </LinkWithDisabled>
      {isReloading ? null : (
        <Dropdown overlay={newTracingMenu}>
          <a
            className="ant-dropdown-link"
            onClick={e => e.preventDefault()}
            style={{ display: "inline-block", marginLeft: 2 }}
          >
            <Icon type="down" />
          </a>
        </Dropdown>
      )}
    </React.Fragment>
  );
}

function ImportLink({ dataset }) {
  return (
    <div>
      <Link
        to={`/datasets/${dataset.owningOrganization}/${dataset.name}/import`}
        className="import-dataset"
      >
        <Icon type="plus-circle-o" />
        Import
      </Link>

      <div className="text-danger">{dataset.dataSource.status}</div>
    </div>
  );
}

type Props = {
  dataset: APIMaybeUnimportedDataset,
};

type State = {
  isReloading: boolean,
};

function LinkWithDisabled({
  disabled,
  ...rest
}: {
  disabled?: boolean,
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

  return (
    <Link {...rest} style={adaptedStyle} onClick={e => (disabled ? e.preventDefault() : null)} />
  );
}

class DatasetActionView extends React.PureComponent<Props, State> {
  state = {
    isReloading: false,
  };

  clearCache = async (dataset: APIMaybeUnimportedDataset) => {
    this.setState({ isReloading: true });
    await clearCache(dataset);
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

    return (
      <div>
        {dataset.isEditable && !dataset.isActive ? <ImportLink dataset={dataset} /> : null}
        {dataset.isActive ? (
          <div className="dataset-actions nowrap">
            {!dataset.isForeign ? (
              <NewAnnotationLink dataset={dataset} isReloading={isReloading} />
            ) : (
              <p style={disabledWhenReloadingStyle}>
                New Annotation &nbsp;
                <Tooltip title="Cannot create annotations for read-only datasets">
                  <Icon type="info-circle-o" style={{ color: "gray" }} />
                </Tooltip>
              </p>
            )}
            <LinkWithDisabled
              to={`/datasets/${dataset.owningOrganization}/${dataset.name}/view`}
              title="View Dataset"
              disabled={isReloading}
            >
              <Icon type="eye-o" />
              View
            </LinkWithDisabled>
            {dataset.isEditable ? (
              <React.Fragment>
                <LinkWithDisabled
                  to={`/datasets/${dataset.owningOrganization}/${dataset.name}/edit`}
                  title="Edit Dataset"
                  disabled={isReloading}
                >
                  <Icon type="edit" />
                  Edit
                </LinkWithDisabled>
                {!dataset.isForeign ? (
                  <a
                    onClick={() => this.clearCache(dataset)}
                    title="Reload Dataset"
                    style={disabledWhenReloadingStyle}
                    type="link"
                  >
                    {isReloading ? <Icon type="loading" /> : <Icon type="retweet" />}
                    Reload
                  </a>
                ) : null}
              </React.Fragment>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
}

export default withRouter(DatasetActionView);
