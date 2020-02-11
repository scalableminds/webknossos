// @flow
import { Dropdown, Menu, Icon, Tooltip } from "antd";
import { Link, type RouterHistory, withRouter } from "react-router-dom";
import * as React from "react";

import type { APIMaybeUnimportedDataset, TracingType } from "admin/api_flow_types";
import { createExplorational, clearCache } from "admin/admin_rest_api";
import Toast from "libs/toast";
import messages from "messages";
import { trackAction } from "oxalis/model/helpers/analytics";

export const createTracingOverlayMenu = (dataset: APIMaybeUnimportedDataset, type: TracingType) => {
  const typeCapitalized = type.charAt(0).toUpperCase() + type.slice(1);
  return (
    <Menu>
      <Menu.Item key="existing">
        <Link
          to={`/datasets/${dataset.owningOrganization}/${
            dataset.name
          }/createExplorative/${type}/true`}
          title={`Create ${typeCapitalized} Tracing`}
        >
          Use Existing Segmentation Layer
        </Link>
      </Menu.Item>
      <Menu.Item key="new">
        <Link
          to={`/datasets/${dataset.owningOrganization}/${
            dataset.name
          }/createExplorative/${type}/false`}
          title={`Create ${typeCapitalized} Tracing`}
        >
          Use a New Segmentation Layer
        </Link>
      </Menu.Item>
    </Menu>
  );
};

type Props = {
  dataset: APIMaybeUnimportedDataset,
  isUserAdmin: boolean,
  history: RouterHistory,
};

type State = {};

class DatasetActionView extends React.PureComponent<Props, State> {
  clearCache = async (dataset: APIMaybeUnimportedDataset) => {
    await clearCache(dataset);
    Toast.success(messages["dataset.clear_cache_success"]);
  };

  render() {
    const { dataset } = this.props;
    const centerBackgroundImageStyle = {
      verticalAlign: "middle",
    };

    const volumeTracingMenu = (
      <Dropdown overlay={createTracingOverlayMenu(dataset, "volume")} trigger={["click"]}>
        <a href="#" title="Create Volume Tracing">
          <img
            src="/assets/images/volume.svg"
            alt="volume icon"
            style={centerBackgroundImageStyle}
          />{" "}
          Start Volume Tracing
        </a>
      </Dropdown>
    );

    const hybridTracingMenu = (
      <Dropdown overlay={createTracingOverlayMenu(dataset, "hybrid")} trigger={["click"]}>
        <a href="#" title="Create Hybrid (Skeleton + Volume) Tracing">
          <Icon type="swap" />
          Start Hybrid Tracing
        </a>
      </Dropdown>
    );

    return (
      <div>
        {this.props.isUserAdmin && dataset.dataSource.dataLayers == null ? (
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
        ) : null}
        {dataset.isActive ? (
          <div className="dataset-actions nowrap">
            {this.props.isUserAdmin && dataset.isEditable ? (
              <React.Fragment>
                <Link
                  to={`/datasets/${dataset.owningOrganization}/${dataset.name}/edit`}
                  title="Edit Dataset"
                >
                  <Icon type="edit" />
                  Edit
                </Link>
                {!dataset.isForeign ? (
                  <a href="#" onClick={() => this.clearCache(dataset)} title="Reload Dataset">
                    <Icon type="retweet" />
                    Reload
                  </a>
                ) : null}
              </React.Fragment>
            ) : null}
            <Link
              to={`/datasets/${dataset.owningOrganization}/${dataset.name}/view`}
              title="View Dataset"
            >
              <Icon type="eye-o" />
              View
            </Link>
            {!dataset.isForeign ? (
              <React.Fragment>
                <Link
                  to={`/datasets/${dataset.owningOrganization}/${
                    dataset.name
                  }/createExplorative/skeleton/false`}
                  title="Create Skeleton Tracing"
                >
                  <img
                    src="/assets/images/skeleton.svg"
                    alt="skeleton icon"
                    style={centerBackgroundImageStyle}
                  />{" "}
                  Start Skeleton Tracing
                </Link>
                {volumeTracingMenu}
                {hybridTracingMenu}
              </React.Fragment>
            ) : (
              <p>
                Start Tracing &nbsp;
                <Tooltip title="Cannot create tracings for read-only datasets">
                  <Icon type="info-circle-o" style={{ color: "gray" }} />
                </Tooltip>
              </p>
            )}
          </div>
        ) : null}
      </div>
    );
  }
}

export default withRouter(DatasetActionView);
