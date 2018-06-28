// @flow
/* eslint-disable jsx-a11y/href-no-hash */
import * as React from "react";
import { connect } from "react-redux";
import { Row, Col, Modal, Card, Dropdown, Menu, Icon } from "antd";
import Utils from "libs/utils";
import Markdown from "react-remarkable";
import TemplateHelpers from "libs/template_helpers";
import messages from "messages";
import { createExplorational } from "admin/admin_rest_api";

import type { DatasetType } from "dashboard/dataset_view";
import type { OxalisState } from "oxalis/store";
import type { APIUserType } from "admin/api_flow_types";

const padding = 16;
const thumbnailDimension = "500";
const columnSpan = { xs: 24, sm: 24, md: 24, lg: 12, xl: 12, xxl: 8 };

type StateProps = {
  activeUser: ?APIUserType,
};

type Props = {
  datasets: Array<DatasetType>,
  searchQuery: string,
} & StateProps;

class GalleryDatasetView extends React.PureComponent<Props> {
  createTracing = async (
    dataset: DatasetType,
    typ: "volume" | "skeleton",
    withFallback: boolean,
  ) => {
    if (this.props.activeUser == null) {
      Modal.confirm({
        content: messages["dataset.confirm_signup"],
        onOk: () => {
          window.location.href = "/auth/register";
        },
      });
    } else {
      const annotation = await createExplorational(dataset.name, typ, withFallback);
      window.location.href = `/annotations/${annotation.typ}/${annotation.id}`;
    }
  };

  renderCard(dataset: DatasetType) {
    let description;
    if (dataset.description) {
      description = (
        <Markdown
          source={dataset.description}
          options={{ html: false, breaks: true, linkify: true }}
        />
      );
    } else {
      description = dataset.hasSegmentation ? (
        <p>Original data and segmentation</p>
      ) : (
        <p>Original data</p>
      );
    }

    const menu = (
      <Menu>
        <Menu.Item key="existing">
          <a
            href="#"
            onClick={() => this.createTracing(dataset, "volume", true)}
            title="Create Volume Tracing"
          >
            Use Existing Segmentation Layer
          </a>
        </Menu.Item>
        <Menu.Item key="new">
          <a
            href="#"
            onClick={() => this.createTracing(dataset, "volume", false)}
            title="Create Volume Tracing"
          >
            Use a New Segmentation Layer
          </a>
        </Menu.Item>
      </Menu>
    );

    const volumeTracingMenu = (
      <Dropdown overlay={menu} trigger={["click"]}>
        <a href="#" title="Create Volume Tracing">
          <img src="/assets/images/volume.svg" alt="Volume" />
        </a>
      </Dropdown>
    );

    return (
      <Card bodyStyle={{ padding: 0 }} className="spotlight-item-card">
        <span
          className="dataset-thumbnail"
          style={{
            background: `url(${
              dataset.thumbnailURL
            }?w=${thumbnailDimension}&h=${thumbnailDimension})`,
            backgroundSize: "cover",
          }}
        >
          <div className="dataset-thumbnail-buttons">
            <a href={`/datasets/${dataset.name}/view`} title="View Dataset">
              <Icon type="eye-o" className="view-button" />
            </a>
            <a
              href="#"
              title="Create skeleton tracing"
              onClick={() => this.createTracing(dataset, "skeleton", false)}
            >
              <img src="/assets/images/skeleton.svg" alt="Skeleton" />
            </a>
            {volumeTracingMenu}
          </div>
        </span>
        <div className="dataset-description">
          <div className="description-flex">
            <h3>
              {dataset.displayName != null && dataset.displayName !== ""
                ? dataset.displayName
                : dataset.name}
            </h3>
            <div className="dataset-description-body">
              <p>Scale: {TemplateHelpers.formatScale(dataset.dataSource.scale)}</p>
              {description}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  render() {
    return (
      <Row gutter={padding}>
        {Utils.filterWithSearchQueryAND(
          this.props.datasets.filter(ds => ds.isActive),
          ["name", "description"],
          this.props.searchQuery,
        )
          .sort(Utils.localeCompareBy(([]: DatasetType[]), "formattedCreated", false))
          .map(ds => (
            <Col className="gallery-dataset-col" {...columnSpan} key={ds.name}>
              {this.renderCard(ds)}
            </Col>
          ))}
      </Row>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect(mapStateToProps)(GalleryDatasetView);
