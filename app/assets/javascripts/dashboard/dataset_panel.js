import * as React from "react";
import { Row, Col, Menu, Dropdown, Card, Icon } from "antd";
import Markdown from "react-remarkable";
import TemplateHelpers from "libs/template_helpers";

import type { DatasetType } from "dashboard/dataset_view";

const padding = 16;
const columnSpan = { xs: 24, sm: 24, md: 24, lg: 12, xl: 12, xxl: 8 };
const thumbnailDimension = "500";
const smallScreenWidth = 992;
const mediumScreenWidth = 1600;

type Props = {
  datasets: Array<DatasetType>,
  owningOrganization: string,
};

type State = {
  showLessContent: boolean,
};

class DatasetPanel extends React.PureComponent<Props, State> {
  constructor(props) {
    super(props);
    this.state = {
      showLessContent: true,
    };
    this.handleClick = this.handleClick.bind(this);
  }

  handleClick = () => {
    if (this.state.showLessContent === true) {
      this.showMorePressed();
    } else {
      this.showLessPressed();
    }
  };

  showMorePressed = () => {
    this.setState({
      showLessContent: false,
    });
  };

  showLessPressed = () => {
    this.setState({
      showLessContent: true,
    });
  };

  renderCard = (dataset: DatasetType) => {
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
  };

  getDatasetsToDisplay: Array<DatasetType> = () => {
    if (!this.state.showLessContent) {
      return this.props.datasets;
    }
    let datasets;
    const width = window.innerWidth;
    if (width < smallScreenWidth) {
      // when there is only one dataset in each row
      datasets = this.props.datasets.slice(0, 3);
    } else if (width < mediumScreenWidth) {
      // when there are two
      datasets = this.props.datasets.slice(0, 6);
    } else {
      // when there are three
      datasets = this.props.datasets.slice(0, 9);
    }
    return datasets;
  };

  renderShowMoreLink = () => {
    const width = window.innerWidth;
    if (width < smallScreenWidth) {
      if (this.props.datasets.length <= 3) {
        return null;
      }
    } else if (width < mediumScreenWidth) {
      if (this.props.datasets.length <= 6) {
        return null;
      }
    } else if (this.props.datasets.length <= 9) {
      return null;
    }
    return (
      <a className="show-more-link" onClick={this.handleClick}>
        {this.state.showLessContent ? "show more" : "show less"}
      </a>
    );
  };

  // TODO listen to width resizing and trigger rerender if entering "another level of width"

  render() {
    return (
      <div className="dataset-panel">
        <h1>{this.props.owningOrganization}</h1>
        <Row gutter={padding}>
          {this.getDatasetsToDisplay().map(ds => (
            <Col className="gallery-dataset-col" {...columnSpan} key={ds.name}>
              {this.renderCard(ds)}
            </Col>
          ))}
        </Row>
        {this.renderShowMoreLink()}
      </div>
    );
  }
}

export default DatasetPanel;
