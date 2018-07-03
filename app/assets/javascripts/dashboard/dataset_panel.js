// @flow
import * as React from "react";
import { Row, Col, Card, Popover, Button } from "antd";
import Markdown from "react-remarkable";
import TemplateHelpers from "libs/template_helpers";
import _ from "lodash";

import type { DatasetType } from "dashboard/dataset_view";

const columnSpan = { xs: 24, sm: 24, md: 24, lg: 12, xl: 12, xxl: 8 };
const thumbnailDimension = "500";
const croppedDatasetCount = 6;

type Props = {
  datasets: Array<DatasetType>,
  owningOrganization: string,
  showOrganizationHeader: boolean,
  limitDefaultDatasetCount: boolean,
};

type State = {
  showLessContent: boolean,
};

function getDisplayName(dataset: DatasetType): string {
  return dataset.displayName != null && dataset.displayName !== ""
    ? dataset.displayName
    : dataset.name;
}

function getDescription(dataset: DatasetType) {
  let freeTextDescription = null;
  if (dataset.description) {
    freeTextDescription = (
      <Markdown
        source={dataset.description}
        options={{ html: false, breaks: true, linkify: true }}
      />
    );
  } else {
    freeTextDescription = dataset.hasSegmentation ? (
      <p>Original data and segmentation</p>
    ) : (
      <p>Original data</p>
    );
  }

  return (
    <div>
      <p>Scale: {TemplateHelpers.formatScale(dataset.dataSource.scale)}</p>
      {freeTextDescription}
    </div>
  );
}

function ThumbnailAndDescription({
  thumbnailURL,
  description,
  name,
}: {
  thumbnailURL: string,
  name: string,
  description: React.Element<*> | string,
}) {
  return (
    <React.Fragment>
      <span className="dataset-thumbnail" title="Click to view dataset">
        <div
          className="dataset-thumbnail-image"
          style={{
            background: `url(${thumbnailURL}?w=${thumbnailDimension}&h=${thumbnailDimension})`,
            backgroundSize: "cover",
            width: "100%",
            height: "100%",
          }}
        />
      </span>
      <div className="dataset-description">
        <div className="description-flex">
          <h3>{name}</h3>
          <div className="dataset-description-body">{description}</div>
        </div>
      </div>
    </React.Fragment>
  );
}

function ThumbnailAndDescriptionFromDataset({ dataset }: { dataset: DatasetType }) {
  return (
    <ThumbnailAndDescription
      thumbnailURL={dataset.thumbnailURL}
      name={getDisplayName(dataset)}
      description={getDescription(dataset)}
    />
  );
}

class DatasetPanel extends React.PureComponent<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      showLessContent: true,
    };
  }

  handleClick = () => {
    this.setState({ showLessContent: !this.state.showLessContent });
  };

  renderCard = (dataset: DatasetType) => {
    const description = getDescription(dataset);

    return (
      <a href={`/datasets/${dataset.name}/view`} title="View Dataset">
        <Card bodyStyle={{ padding: 0 }} className="spotlight-item-card">
          <ThumbnailAndDescriptionFromDataset dataset={dataset} />
        </Card>
      </a>
    );
  };

  renderMultiDatasetCard = (groupName: string, datasets: DatasetType[]) => {
    const multiDescription = (
      <div>
        This collection consists of multiple datasets:
        <ul>
          {datasets.map(dataset => {
            const description = getDescription(dataset);
            const popoverContent = (
              <div className="spotlight-popover-card">
                <ThumbnailAndDescriptionFromDataset dataset={dataset} />
              </div>
            );
            return (
              <li>
                <Popover
                  placement="left"
                  content={popoverContent}
                  trigger="hover"
                  overlayClassName="antd-spotlight-popover-card"
                >
                  <a href="#">{getDisplayName(dataset)}</a>
                </Popover>
              </li>
            );
          })}
        </ul>
      </div>
    );

    return (
      <Card bodyStyle={{ padding: 0 }} className="spotlight-item-card">
        <ThumbnailAndDescription
          thumbnailURL={datasets[0].thumbnailURL}
          name={groupName}
          description={multiDescription}
        />
      </Card>
    );
  };

  render() {
    const groupedDatasets = _.entries(
      // Instead of dataset.name, this could be grouped by a group tag
      _.groupBy(this.props.datasets, dataset => dataset.name),
    );
    const maybeCroppedDatasetsGroup = groupedDatasets.slice(
      0,
      this.state.showLessContent && this.props.limitDefaultDatasetCount
        ? croppedDatasetCount
        : this.props.datasets.length,
    );

    return (
      <div className="dataset-panel">
        {this.props.showOrganizationHeader && <h1>{this.props.owningOrganization}</h1>}
        <Row gutter={16}>
          {maybeCroppedDatasetsGroup.map(([groupName, datasets]) => (
            <Col className="gallery-dataset-col" {...columnSpan} key={groupName}>
              {datasets.length === 1
                ? this.renderCard(datasets[0])
                : this.renderMultiDatasetCard(groupName, datasets)}
            </Col>
          ))}
        </Row>
        {this.props.limitDefaultDatasetCount &&
          groupedDatasets.length > croppedDatasetCount && (
            <a className="show-more-link" onClick={this.handleClick}>
              {this.state.showLessContent ? "show more" : "show less"}
            </a>
          )}
      </div>
    );
  }
}

export default DatasetPanel;
