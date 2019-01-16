// @flow
import { Row, Col, Card, Button } from "antd";
import Markdown from "react-remarkable";
import * as React from "react";
import _ from "lodash";
import classNames from "classnames";

import type { APIDataset, APIDatasetId } from "admin/api_flow_types";
import { formatScale } from "libs/format_utils";
import {
  getThumbnailURL,
  hasSegmentation,
  getSegmentationThumbnailURL,
} from "oxalis/model/accessors/dataset_accessor";

const columnSpan = { xs: 24, sm: 24, md: 24, lg: 24, xl: 12, xxl: 12 };
const thumbnailDimension = 500;
const miniThumbnailDimension = 50;

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

  return <div>{freeTextDescription}</div>;
}

function getDetails(dataset: APIDataset) {
  const { dataSource, details } = dataset;
  return { scale: formatScale(dataSource.scale), name: dataset.name, ...details };
}

function ThumbnailAndDescription({
  thumbnailURL,
  description,
  details,
  name,
  datasetId,
  segmentationThumbnailURL,
}: {
  thumbnailURL: string,
  name: string,
  datasetId: APIDatasetId,
  description: React.Element<*> | string,
  details: Object,
  segmentationThumbnailURL: ?string,
}) {
  return (
    <React.Fragment>
      <div className="dataset-description">
        <div className="description-flex">
          <h3 style={{ fontSize: 20 }}>{name}</h3>
          <div className="dataset-description-body">{description}</div>
        </div>
      </div>
      <span className="dataset-thumbnail">
        <a href={`/datasets/${datasetId.owningOrganization}/${datasetId.name}/view`}>
          <div className="dataset-click-hint">Click To View</div>
          <div
            className="dataset-thumbnail-image"
            style={{
              backgroundImage: `url('${thumbnailURL}?w=${thumbnailDimension}&h=${thumbnailDimension}')`,
            }}
          />
          {segmentationThumbnailURL ? (
            <div
              className="dataset-thumbnail-image segmentation"
              style={{
                backgroundImage: `url('${segmentationThumbnailURL}?w=${thumbnailDimension}&h=${thumbnailDimension}')`,
              }}
            />
          ) : null}
          <div className="dataset-thumbnail-overlay">
            <div
              style={{
                textTransform: "uppercase",
                fontSize: 16,
              }}
            >
              {details.name}
            </div>
            <div>
              {details.species && (
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    display: "inline",
                  }}
                >
                  {details.species}
                </div>
              )}
              {details["brain-region"] && (
                <div
                  style={{
                    display: "inline",
                    marginLeft: 5,
                  }}
                >
                  {details["brain-region"]}
                </div>
              )}
            </div>
            <div style={{ marginTop: "auto" }}>
              {details.acquisition && (
                <div style={{ display: "inline-block", color: "rgba(200,200,200,0.85)" }}>
                  {details.acquisition}
                </div>
              )}
              {details.scale && (
                <span style={{ float: "right", color: "rgba(200,200,200,0.85)" }}>
                  Scale: {details.scale}
                </span>
              )}
            </div>
          </div>
        </a>
      </span>
    </React.Fragment>
  );
}

function DatasetCard({ dataset }: { dataset: APIDataset }) {
  return (
    <Card bodyStyle={{ padding: 0 }} className="spotlight-item-card" bordered={false}>
      <ThumbnailAndDescription
        thumbnailURL={getThumbnailURL(dataset)}
        name={getDisplayName(dataset)}
        datasetId={{ name: dataset.name, owningOrganization: dataset.owningOrganization }}
        description={getDescription(dataset)}
        details={getDetails(dataset)}
        segmentationThumbnailURL={
          hasSegmentation(dataset) ? getSegmentationThumbnailURL(dataset) : null
        }
      />
    </Card>
  );
}

type MultiDatasetCardProps = { datasets: Array<APIDataset> };
type MultiDatasetCardState = { selectedDataset: APIDataset, hoveredDataset: ?APIDataset };

class MultiDatasetCard extends React.PureComponent<MultiDatasetCardProps, MultiDatasetCardState> {
  state = {
    selectedDataset: this.props.datasets[0],
    hoveredDataset: null,
  };

  render() {
    const { datasets } = this.props;
    const { selectedDataset, hoveredDataset } = this.state;
    const activeDataset = hoveredDataset || selectedDataset;
    const { publication } = activeDataset;
    // This method will only be called for datasets with a publication, but Flow doesn't know that
    if (publication == null) return null;

    const multiDescription = (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <span style={{ marginBottom: 16 }}>{publication.details}</span>
        <div style={{ marginTop: "auto" }}>
          <span style={{ fontSize: 14, textTransform: "uppercase" }}>Published Datasets </span>
          <div className="mini-dataset-thumbnail-grid">
            {datasets.map(dataset => (
              <Button
                className={classNames("mini-dataset-thumbnail", {
                  active: dataset === activeDataset,
                })}
                key={dataset.name}
                title="Click To Select"
                style={{
                  background: `url('${getThumbnailURL(
                    dataset,
                  )}?w=${miniThumbnailDimension}&h=${miniThumbnailDimension}')`,
                  width: `${miniThumbnailDimension}px`,
                  height: `${miniThumbnailDimension}px`,
                }}
                onMouseEnter={() => this.setState({ hoveredDataset: dataset })}
                onMouseLeave={() => this.setState({ hoveredDataset: null })}
                onClick={() => this.setState({ selectedDataset: dataset })}
              />
            ))}
          </div>
        </div>
      </div>
    );

    return (
      <Card bodyStyle={{ padding: 0 }} className="spotlight-item-card" bordered={false}>
        <ThumbnailAndDescription
          thumbnailURL={getThumbnailURL(activeDataset)}
          name={publication.title}
          datasetId={{
            name: activeDataset.name,
            owningOrganization: activeDataset.owningOrganization,
          }}
          description={multiDescription}
          details={getDetails(activeDataset)}
          segmentationThumbnailURL={
            hasSegmentation(activeDataset) ? getSegmentationThumbnailURL(activeDataset) : null
          }
        />
      </Card>
    );
  }
}

type DatasetPanelProps = {
  datasets: Array<APIDataset>,
  organizationName: string,
  showOrganizationHeader: boolean,
  croppedDatasetCount: ?number,
};

type DatasetPanelState = {
  showLessContent: boolean,
};

class DatasetPanel extends React.PureComponent<DatasetPanelProps, DatasetPanelState> {
  state = {
    showLessContent: true,
  };

  handleClick = () => {
    this.setState(prevState => ({ showLessContent: !prevState.showLessContent }));
  };

  render() {
    const groupedDatasets = _.entries(
      _.groupBy(
        this.props.datasets,
        dataset => (dataset.publication != null ? dataset.publication.id : dataset.name),
      ),
    );
    const maybeCroppedDatasetsGroup =
      this.state.showLessContent && this.props.croppedDatasetCount != null
        ? groupedDatasets.slice(0, this.props.croppedDatasetCount)
        : groupedDatasets;

    return (
      <div className="dataset-panel">
        {this.props.showOrganizationHeader && (
          <h1 className="organization-header">{this.props.organizationName}</h1>
        )}
        <Row gutter={24}>
          {maybeCroppedDatasetsGroup.map(([groupName, datasets]) => (
            <Col className="gallery-dataset-col" {...columnSpan} key={groupName}>
              {datasets[0].publication == null ? (
                <DatasetCard dataset={datasets[0]} />
              ) : (
                <MultiDatasetCard datasets={datasets} />
              )}
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
