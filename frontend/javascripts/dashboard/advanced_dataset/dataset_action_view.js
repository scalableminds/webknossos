// @flow
import { Dropdown, Menu, Icon, Tooltip } from "antd";
import { Link, type RouterHistory, withRouter } from "react-router-dom";
import * as React from "react";

import type { APIMaybeUnimportedDataset, TracingType } from "admin/api_flow_types";
import { createExplorational, clearCache } from "admin/admin_rest_api";
import Toast from "libs/toast";
import messages from "messages";
import { trackAction } from "oxalis/model/helpers/analytics";

export const createTracingOverlayMenu = (
  dataset: APIMaybeUnimportedDataset,
  type: TracingType,
  onClick: (APIMaybeUnimportedDataset, TracingType, boolean) => Promise<void>,
) => {
  const typeCapitalized = type.charAt(0).toUpperCase() + type.slice(1);
  return (
    <Menu>
      <Menu.Item key="existing" onClick={() => onClick(dataset, type, true)}>
        <a href="#" title={`Create ${typeCapitalized} Tracing`}>
          Use Existing Segmentation Layer
        </a>
      </Menu.Item>
      <Menu.Item key="new" onClick={() => onClick(dataset, type, false)}>
        <a href="#" title={`Create ${typeCapitalized} Tracing`}>
          Use a New Segmentation Layer
        </a>
      </Menu.Item>
    </Menu>
  );
};

type Props = {
  dataset: APIMaybeUnimportedDataset,
  isUserAdmin: boolean,
  history: RouterHistory,
};

type State = {
  isReloading: boolean,
};

class DatasetActionView extends React.PureComponent<Props, State> {
  state = {
    isReloading: false,
  };

  createTracing = async (
    dataset: APIMaybeUnimportedDataset,
    type: TracingType,
    withFallback: boolean,
  ) => {
    const annotation = await createExplorational(dataset, type, withFallback);
    trackAction(`Create ${type} tracing`);
    this.props.history.push(`/annotations/${annotation.typ}/${annotation.id}`);
  };

  clearCache = async (dataset: APIMaybeUnimportedDataset) => {
    this.setState({ isReloading: true });
    await clearCache(dataset);
    Toast.success(messages["dataset.clear_cache_success"]);
    this.setState({ isReloading: false });
  };

  render() {
    const { dataset } = this.props;
    const { isReloading } = this.state;
    const centerBackgroundImageStyle = {
      verticalAlign: "middle",
    };

    const volumeTracingMenu = (
      <Dropdown
        overlay={createTracingOverlayMenu(dataset, "volume", this.createTracing)}
        trigger={["click"]}
      >
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
      <Dropdown
        overlay={createTracingOverlayMenu(dataset, "hybrid", this.createTracing)}
        trigger={["click"]}
      >
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
                  title={
                    isReloading
                      ? "You have to wait with the editing until this dataset is reloaded."
                      : "Edit Dataset"
                  }
                  style={isReloading ? { textDecoration: "line-through" } : null}
                  onClick={e => (isReloading ? e.preventDefault() : null)}
                >
                  <Icon type="edit" />
                  Edit
                </Link>
                {!dataset.isForeign ? (
                  <a
                    href="#"
                    onClick={() => this.clearCache(dataset)}
                    title="Reload Dataset"
                    style={isReloading ? { pointerEvents: "none" } : null}
                  >
                    {isReloading ? <Icon type="loading" /> : <Icon type="retweet" />}
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
                <a
                  href="#"
                  onClick={() => this.createTracing(dataset, "skeleton", false)}
                  title="Create Skeleton Tracing"
                >
                  <img
                    src="/assets/images/skeleton.svg"
                    alt="skeleton icon"
                    style={centerBackgroundImageStyle}
                  />{" "}
                  Start Skeleton Tracing
                </a>
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
