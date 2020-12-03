// @flow
import { Dropdown, Menu, Icon, Tooltip } from "antd";
import { Link, withRouter } from "react-router-dom";
import * as React from "react";

import type { APIMaybeUnimportedDataset, TracingType, APIDatasetId } from "types/api_flow_types";
import { clearCache } from "admin/admin_rest_api";
import Toast from "libs/toast";
import messages from "messages";

const createTracingOverlayMenu = (dataset: APIMaybeUnimportedDataset, type: TracingType) => {
  const typeCapitalized = type.charAt(0).toUpperCase() + type.slice(1);

  const hasSegmentationLayer =
    dataset.dataSource.dataLayers != null
      ? dataset.dataSource.dataLayers.find(layer => layer.category === "segmentation") != null
      : false;
  const disabledLinkStyle = { pointerEvents: "none", color: "rgb(173, 173, 173)" };

  return (
    <Menu>
      <Menu.Item key="existing" disabled={!hasSegmentationLayer}>
        <Link
          to={`/datasets/${dataset.owningOrganization}/${
            dataset.name
          }/createExplorative/${type}/true`}
          title={`Create ${typeCapitalized} Annotation`}
          style={hasSegmentationLayer ? {} : disabledLinkStyle}
        >
          Use Existing Segmentation Layer
        </Link>
      </Menu.Item>
      <Menu.Item key="new">
        <Link
          to={`/datasets/${dataset.owningOrganization}/${
            dataset.name
          }/createExplorative/${type}/false`}
          title={`Create ${typeCapitalized} Annotation`}
        >
          Use a New Segmentation Layer
        </Link>
      </Menu.Item>
    </Menu>
  );
};

export const createTracingOverlayMenuWithCallback = (
  dataset: APIMaybeUnimportedDataset,
  type: TracingType,
  onClick: (APIMaybeUnimportedDataset, TracingType, boolean) => Promise<void>,
) => {
  const typeCapitalized = type.charAt(0).toUpperCase() + type.slice(1);
  return (
    <Menu>
      <Menu.Item key="existing" onClick={() => onClick(dataset, type, true)}>
        <a href="#" title={`Create ${typeCapitalized} Annotation`}>
          Use Existing Segmentation Layer
        </a>
      </Menu.Item>
      <Menu.Item key="new" onClick={() => onClick(dataset, type, false)}>
        <a href="#" title={`Create ${typeCapitalized} Annotation`}>
          Use a New Segmentation Layer
        </a>
      </Menu.Item>
    </Menu>
  );
};

type Props = {
  dataset: APIMaybeUnimportedDataset,
  updateDataset: APIDatasetId => Promise<void>,
};

type State = {
  isReloading: boolean,
};

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
    const centerBackgroundImageStyle: { verticalAlign: string, filter?: string } = {
      verticalAlign: "middle",
    };
    if (isReloading) {
      // We need to explicitly grayscale the images when the dataset is being reloaded.
      centerBackgroundImageStyle.filter = "grayscale(100%) opacity(25%)";
    }
    const disabledWhenReloadingStyle = isReloading
      ? { pointerEvents: "none", color: "rgba(0, 0, 0, 0.25)" }
      : null;
    const disabledWhenReloadingAction = e => (isReloading ? e.preventDefault() : null);

    const volumeTracingMenu = (
      <Dropdown
        overlay={createTracingOverlayMenu(dataset, "volume")}
        trigger={["click"]}
        disabled={isReloading}
      >
        <a href="#" title="Create Volume Annotation">
          <img
            src="/assets/images/volume.svg"
            alt="volume icon"
            style={centerBackgroundImageStyle}
          />{" "}
          Start Volume Annotation
        </a>
      </Dropdown>
    );

    const hybridTracingMenu = (
      <Dropdown
        overlay={createTracingOverlayMenu(dataset, "hybrid")}
        trigger={["click"]}
        disabled={isReloading}
      >
        <a href="#" title="Create Hybrid (Skeleton + Volume) Annotation">
          <Icon type="swap" />
          Start Hybrid Annotation
        </a>
      </Dropdown>
    );

    const reloadOption = !dataset.isForeign ? (
      <a
        href="#"
        onClick={() => this.clearCache(dataset)}
        title="Reload Dataset"
        style={disabledWhenReloadingStyle}
      >
        {isReloading ? <Icon type="loading" /> : <Icon type="retweet" />}
        Reload
      </a>
    ) : null;

    return (
      <div>
        {dataset.isEditable && dataset.dataSource.dataLayers == null ? (
          <div className="dataset-actions">
            <Link
              to={`/datasets/${dataset.owningOrganization}/${dataset.name}/import`}
              className="import-dataset"
            >
              <Icon type="plus-circle-o" />
              Import
            </Link>
            {reloadOption}
            <div className="text-danger">{dataset.dataSource.status}</div>
          </div>
        ) : null}
        {dataset.isActive ? (
          <div className="dataset-actions nowrap">
            {dataset.isEditable ? (
              <React.Fragment>
                <Link
                  to={`/datasets/${dataset.owningOrganization}/${dataset.name}/edit`}
                  title="Edit Dataset"
                  style={disabledWhenReloadingStyle}
                  onClick={disabledWhenReloadingAction}
                >
                  <Icon type="edit" />
                  Edit
                </Link>
                {reloadOption}
              </React.Fragment>
            ) : null}
            <Link
              to={`/datasets/${dataset.owningOrganization}/${dataset.name}/view`}
              title="View Dataset"
              style={disabledWhenReloadingStyle}
              onClick={disabledWhenReloadingAction}
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
                  style={disabledWhenReloadingStyle}
                  onClick={disabledWhenReloadingAction}
                  title="Create Skeleton Annotation"
                >
                  <img
                    src="/assets/images/skeleton.svg"
                    alt="skeleton icon"
                    style={centerBackgroundImageStyle}
                  />{" "}
                  Start Skeleton Annotation
                </Link>
                {volumeTracingMenu}
                {hybridTracingMenu}
              </React.Fragment>
            ) : (
              <p style={disabledWhenReloadingStyle}>
                Start Annotation &nbsp;
                <Tooltip title="Cannot create annotations for read-only datasets">
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
