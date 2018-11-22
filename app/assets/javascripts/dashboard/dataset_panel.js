// @flow
import { Row, Col, Card, Popover } from "antd";
import Markdown from "react-remarkable";
import * as React from "react";
import _ from "lodash";

import type { APIDataset } from "admin/api_flow_types";
import { formatScale } from "libs/format_utils";
import { getThumbnailURL, hasSegmentation } from "oxalis/model/accessors/dataset_accessor";

const columnSpan = { xs: 24, sm: 24, md: 24, lg: 12, xl: 12, xxl: 8 };
const thumbnailDimension = 500;

type Props = {
  datasets: Array<APIDataset>,
  organizationName: string,
  showOrganizationHeader: boolean,
  croppedDatasetCount: ?number,
};

type State = {
  showLessContent: boolean,
};

function getDisplayName(dataset: APIDataset): string {
  return dataset.displayName != null && dataset.displayName !== ""
    ? dataset.displayName
    : dataset.name;
}

function getDescription(dataset: APIDataset) {
  let freeTextDescription = null;
  if (dataset.description) {
    freeTextDescription = (
      <Markdown
        source={dataset.description}
        options={{ html: false, breaks: true, linkify: true }}
      />
    );
  } else {
    freeTextDescription = hasSegmentation(dataset) ? (
      <p>Original data and segmentation</p>
    ) : (
      <p>Original data</p>
    );
  }

  return (
    <div>
      <p>Scale: {formatScale(dataset.dataSource.scale)}</p>
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
            background: `url('${thumbnailURL}?w=${thumbnailDimension}&h=${thumbnailDimension}')`,
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

function ThumbnailAndDescriptionFromDataset({ dataset }: { dataset: APIDataset }) {
  return (
    <ThumbnailAndDescription
      thumbnailURL={getThumbnailURL(dataset)}
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
    this.setState(prevState => ({ showLessContent: !prevState.showLessContent }));
  };

  renderCard = (dataset: APIDataset) => (
    <a href={`/datasets/${dataset.owningOrganization}/${dataset.name}/view`} title="View Dataset">
      <Card bodyStyle={{ padding: 0 }} className="spotlight-item-card">
        <ThumbnailAndDescriptionFromDataset dataset={dataset} />
      </Card>
    </a>
  );

  renderMultiDatasetCard = (groupName: string, datasets: APIDataset[]) => {
    const multiDescription = (
      <div>
        This collection consists of multiple datasets:
        <ul>
          {datasets.map(dataset => {
            const popoverContent = (
              <div className="spotlight-popover-card">
                <ThumbnailAndDescriptionFromDataset dataset={dataset} />
              </div>
            );
            return (
              <li key={dataset.name}>
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
          thumbnailURL={getThumbnailURL(datasets[0])}
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
    const maybeCroppedDatasetsGroup =
      this.state.showLessContent && this.props.croppedDatasetCount != null
        ? groupedDatasets.slice(0, this.props.croppedDatasetCount)
        : groupedDatasets;

    return (
      <div className="dataset-panel">
        {this.props.showOrganizationHeader && <h1>{this.props.organizationName}</h1>}
        <Row gutter={16}>
          {maybeCroppedDatasetsGroup.map(([groupName, datasets]) => (
            <Col className="gallery-dataset-col" {...columnSpan} key={groupName}>
              {datasets.length === 1
                ? this.renderCard(datasets[0])
                : this.renderMultiDatasetCard(groupName, datasets)}
            </Col>
          ))}
        </Row>
        {this.props.croppedDatasetCount != null &&
        groupedDatasets.length > this.props.croppedDatasetCount ? (
          <a className="show-more-link" onClick={this.handleClick}>
            {this.state.showLessContent ? "show more" : "show less"}
          </a>
        ) : null}
      </div>
    );
  }
}

export default DatasetPanel;
