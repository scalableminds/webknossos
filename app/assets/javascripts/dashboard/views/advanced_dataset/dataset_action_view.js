// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import * as React from "react";
import { Link } from "react-router-dom";
import { Dropdown, Menu, Icon } from "antd";
import type { APIDatasetType } from "admin/api_flow_types";
import { createExplorational } from "admin/admin_rest_api";

type Props = {
  dataset: APIDatasetType,
};

type State = {};

export default class DatasetActionView extends React.PureComponent<Props, State> {
  createTracing = async (
    dataset: APIDatasetType,
    typ: "volume" | "skeleton",
    withFallback: boolean,
  ) => {
    const annotation = await createExplorational(dataset, typ, withFallback);
    window.location.href = `/annotations/${annotation.typ}/${annotation.id}`;
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

    const createVolumeTracingMenu = (
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
        {dataset.dataSource.dataLayers == null ? (
          <div>
            <Link to={`/datasets/${dataset.name}/import`} className="import-dataset">
              <Icon type="plus-circle-o" />Import
            </Link>

            <div className="text-danger">{dataset.dataSource.status}</div>
          </div>
        ) : null}
        {dataset.isActive ? (
          <div className="dataset-actions nowrap">
            {dataset.isEditable ? (
              <Link to={`/datasets/${dataset.name}/edit`} title="Edit dataset">
                <Icon type="edit" />Edit
              </Link>
            ) : null}
            <a href={`/datasets/${dataset.name}/view`} title="View dataset">
              <Icon type="eye-o" />View
            </a>
            <a
              href="#"
              onClick={() => this.createTracing(dataset, "skeleton", false)}
              title="Create skeleton tracing"
            >
              <img
                src="/assets/images/skeleton.svg"
                alt="skeleton icon"
                style={centerBackgroundImageStyle}
              />{" "}
              Start Skeleton Tracing
            </a>
            {dataset.dataStore.typ !== "ndstore" ? createVolumeTracingMenu : null}
          </div>
        ) : null}
      </div>
    );
  }
}
