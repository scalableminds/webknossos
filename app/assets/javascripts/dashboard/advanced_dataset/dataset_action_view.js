// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import { Dropdown, Menu, Icon, Tooltip } from "antd";
import { Link, type RouterHistory, withRouter } from "react-router-dom";
import * as React from "react";

import type { APIMaybeUnimportedDataset } from "admin/api_flow_types";
import { createExplorational, triggerDatasetClearCache } from "admin/admin_rest_api";
import Toast from "libs/toast";
import messages from "messages";

type Props = {
  dataset: APIMaybeUnimportedDataset,
  isUserAdmin: boolean,
  history: RouterHistory,
};

type State = {};

class DatasetActionView extends React.PureComponent<Props, State> {
  createTracing = async (
    dataset: APIMaybeUnimportedDataset,
    typ: "skeleton" | "volume" | "hybrid",
    withFallback: boolean,
  ) => {
    const annotation = await createExplorational(dataset, typ, withFallback);
    this.props.history.push(`/annotations/${annotation.typ}/${annotation.id}`);
  };

  clearCache = async (dataset: APIMaybeUnimportedDataset) => {
    await triggerDatasetClearCache(dataset.dataStore.url, dataset);
    Toast.success(messages["dataset.clear_cache_success"]);
  };

  render() {
    const { dataset } = this.props;
    const centerBackgroundImageStyle = {
      verticalAlign: "middle",
    };

    const menu = (
      <Menu>
        <Menu.Item key="existing" onClick={() => this.createTracing(dataset, "volume", true)}>
          <a href="#" title="Create Volume Tracing">
            Use Existing Segmentation Layer
          </a>
        </Menu.Item>
        <Menu.Item key="new" onClick={() => this.createTracing(dataset, "volume", false)}>
          <a href="#" title="Create Volume Tracing">
            Use a New Segmentation Layer
          </a>
        </Menu.Item>
      </Menu>
    );

    const volumeTracingMenu = (
      <Dropdown overlay={menu} trigger={["click"]}>
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

    return (
      <div>
        {this.props.isUserAdmin && dataset.dataSource.dataLayers == null ? (
          <div>
            <Link
              to={`/datasets/${dataset.owningOrganization}/${dataset.name}/import`}
              className="import-dataset"
            >
              <Icon type="plus-circle-o" />Import
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
                  <Icon type="edit" />Edit
                </Link>
                {!dataset.isForeign ? (
                  <a href="#" onClick={() => this.clearCache(dataset)} title="Reload Dataset">
                    <Icon type="retweet" />Reload
                  </a>
                ) : null}
              </React.Fragment>
            ) : null}
            <a
              href={`/datasets/${dataset.owningOrganization}/${dataset.name}/view`}
              title="View Dataset"
            >
              <Icon type="eye-o" />View
            </a>
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
                <a
                  href="#"
                  onClick={() => this.createTracing(dataset, "hybrid", true)}
                  title="Create Hybrid (Skeleton + Volume) Tracing"
                >
                  <Icon type="swap" />
                  Start Hybrid Tracing
                </a>
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
