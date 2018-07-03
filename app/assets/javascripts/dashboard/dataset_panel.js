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
  showOrganizationHeader: boolean,
  limitDefaultDatasetCount: boolean,
};

type State = {
  showLessContent: boolean,
};

const croppedDatasetCount = 6;

class DatasetPanel extends React.PureComponent<Props, State> {
  constructor(props) {
    super(props);
    this.state = {
      showLessContent: true,
    };
  }

  handleClick = () => {
    this.setState({ showLessContent: !this.state.showLessContent });
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

    return (
      <a href={`/datasets/${dataset.name}/view`} title="View Dataset">
        <Card bodyStyle={{ padding: 0 }} className="spotlight-item-card">
          <span className="dataset-thumbnail" title="Click to view dataset">
            <div
              className="dataset-thumbnail-image"
              style={{
                background: `url(${
                  dataset.thumbnailURL
                }?w=${thumbnailDimension}&h=${thumbnailDimension})`,
                backgroundSize: "cover",
                width: "100%",
                height: "100%",
              }}
            />
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
      </a>
    );
  };

  render() {
    const maybeCroppedDatasets = this.props.datasets.slice(
      0,
      this.state.showLessContent && this.props.limitDefaultDatasetCount
        ? croppedDatasetCount
        : this.props.datasets.length,
    );

    return (
      <div className="dataset-panel">
        {this.props.showOrganizationHeader && <h1>{this.props.owningOrganization}</h1>}
        <Row gutter={padding}>
          {maybeCroppedDatasets.map(ds => (
            <Col className="gallery-dataset-col" {...columnSpan} key={ds.name}>
              {this.renderCard(ds)}
            </Col>
          ))}
        </Row>
        {this.props.limitDefaultDatasetCount && (
          <a className="show-more-link" onClick={this.handleClick}>
            {this.state.showLessContent ? "show more" : "show less"}
          </a>
        )}
      </div>
    );
  }
}

export default DatasetPanel;
