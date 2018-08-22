// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import * as React from "react";
import Toast from "libs/toast";
import messages from "messages";
import { Link } from "react-router-dom";
import { Dropdown, Menu, Icon, Tooltip } from "antd";
import type { APIDatasetType } from "admin/api_flow_types";
import { createExplorational, triggerDatasetClearCache } from "admin/admin_rest_api";
import features from "features";

type Props = {
  dataset: APIDatasetType,
  isUserAdmin: boolean,
};

type State = {};

export default class DatasetActionView extends React.PureComponent<Props, State> {
  createTracing = async (
    dataset: APIDatasetType,
    typ: "skeleton" | "volume" | "hybrid",
    withFallback: boolean,
  ) => {
    const annotation = await createExplorational(dataset.name, typ, withFallback);
    window.location.href = `/annotations/${annotation.typ}/${annotation.id}`;
  };

  clearCache = async (dataset: APIDatasetType) => {
    await triggerDatasetClearCache(dataset.dataStore.url, dataset.name);
    Toast.success(messages["dataset.clear_cache_success"]);
  };

  render() {
    const dataset = this.props.dataset;
    const centerBackgroundImageStyle = {
      verticalAlign: "middle",
    };

    const menu = (
      <Menu>
        <Menu.Item key="existing">
          <a
            href="#"
            onClick={() => this.createTracing(dataset, "volume", true)}
            title="Create volume tracing"
          >
            Use Existing Segmentation Layer
          </a>
        </Menu.Item>
        <Menu.Item key="new">
          <a
            href="#"
            onClick={() => this.createTracing(dataset, "volume", false)}
            title="Create volume tracing"
          >
            Use a New Segmentation Layer
          </a>
        </Menu.Item>
      </Menu>
    );

    const volumeTracingMenu = (
      <Dropdown overlay={menu} trigger={["click"]}>
        <a href="#" title="Create volume tracing">
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
            <Link to={`/datasets/${dataset.name}/import`} className="import-dataset">
              <Icon type="plus-circle-o" />Import
            </Link>

            <div className="text-danger">{dataset.dataSource.status}</div>
          </div>
        ) : null}
        {dataset.isActive ? (
          <div className="dataset-actions nowrap">
            {this.props.isUserAdmin && dataset.isEditable ? (
              <React.Fragment>
                <Link to={`/datasets/${dataset.name}/edit`} title="Edit Dataset">
                  <Icon type="edit" />Edit
                </Link>
                {!dataset.isForeign ? (
                  <a href="#" onClick={() => this.clearCache(dataset)} title="Reload Dataset">
                    <Icon type="retweet" />Reload
                  </a>
                ) : null}
              </React.Fragment>
            ) : null}
            <a href={`/datasets/${dataset.name}/view`} title="View Dataset">
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
              </React.Fragment>
            ) : (
              <p>
                Start Tracing &nbsp;
                <Tooltip title="Cannot create tracings for read-only datasets">
                  <Icon type="info-circle-o" style={{ color: "gray" }} />
                </Tooltip>
              </p>
            )}
            {features().hybridTracings ? (
              <a
                href="#"
                onClick={() => this.createTracing(dataset, "hybrid", true)}
                title="Create Hybrid Tracing"
              >
                <Icon type="swap" />
                Start Hybrid Tracing
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
}
