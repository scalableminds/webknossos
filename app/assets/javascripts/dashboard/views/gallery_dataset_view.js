// flow
/* eslint-disable jsx-a11y/href-no-hash */
import * as React from "react";
import { connect } from "react-redux";
import { Row, Col, Modal, Card, Dropdown, Menu } from "antd";
import Utils from "libs/utils";
import Markdown from "react-remarkable";
import TemplateHelpers from "libs/template_helpers";
import messages from "messages";
import type { DatasetType } from "dashboard/views/dataset_view";
import type { OxalisState } from "oxalis/store";

const padding = 16;

type Props = {
  datasets: Array<DatasetType>,
  searchQuery: string,
  activeUser: string,
};

class GalleryDatasetView extends React.PureComponent<Props> {
  static defaultProps = {
    searchQuery: "",
  };

  createTracing = (event: Event) => {
    if (this.props.activeUser === null) {
      event.preventDefault();
      Modal.confirm({
        content: messages["dataset.confirm_signup"],
        onOk: () => {
          window.location.href = "/auth/register";
        },
      });
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
            href={`/datasets/${dataset.name}/trace?typ=volumeTracing&withFallback=true`}
            onClick={this.createTracing}
            title="Create volume tracing"
          >
            Use Existing Segmentation Layer
          </a>
        </Menu.Item>
        <Menu.Item key="new">
          <a
            href={`/datasets/${dataset.name}/trace?typ=volumeTracing&withFallback=false`}
            onClick={this.createTracing}
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
          <img src="/assets/images/volume.svg" alt="Volume" />
        </a>
      </Dropdown>
    );

    return (
      <Card
        bodyStyle={{ padding: 0 }}
        style={{ backgroundImage: `url(${dataset.thumbnailURL})` }}
        className="spotlight-item-card"
      >
        <div className="dataset-thumbnail-buttons">
          <a href={`/datasets/${dataset.name}/view`} title="View dataset">
            <img src="/assets/images/eye.svg" alt="Eye" />
          </a>
          <a
            href={`/datasets/${dataset.name}/trace?typ=skeletonTracing`}
            title="Create skeleton tracing"
            onClick={this.createTracing}
          >
            <img src="/assets/images/skeleton.svg" alt="Skeleton" />
          </a>
          {dataset.dataStore.typ !== "ndstore" ? createVolumeTracingMenu : null}
        </div>
        <div className="dataset-description">
          <h3>{dataset.name}</h3>
          <p>Scale: {TemplateHelpers.formatScale(dataset.dataSource.scale)}</p>
          {description}
        </div>
      </Card>
    );
  }

  render() {
    return (
      <Row gutter={padding}>
        {Utils.filterWithSearchQueryAND(
          this.props.datasets.filter(ds => ds.isActive),
          ["name", "owningTeam", "description"],
          this.props.searchQuery,
        ).map(ds => (
          <Col span={6} key={ds.name} style={{ paddingBottom: padding }}>
            {this.renderCard(ds)}
          </Col>
        ))}
      </Row>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  activeUser: state.activeUser,
});

export default connect(mapStateToProps)(GalleryDatasetView);
