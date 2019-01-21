// @flow
import { Card, Button } from "antd";
import Markdown from "react-remarkable";
import * as React from "react";
import classNames from "classnames";

import type { APIDataset, APIDatasetId } from "admin/api_flow_types";
import { formatScale } from "libs/format_utils";
import {
  getThumbnailURL,
  hasSegmentation,
  getSegmentationThumbnailURL,
} from "oxalis/model/accessors/dataset_accessor";

const thumbnailDimension = 500;
const miniThumbnailDimension = 50;

function getDisplayName(dataset: APIDataset): string {
  return dataset.displayName != null && dataset.displayName !== ""
    ? dataset.displayName
    : dataset.name;
}

function getDetails(dataset: APIDataset) {
  const { dataSource, details } = dataset;
  return { scale: formatScale(dataSource.scale), name: getDisplayName(dataset), ...details };
}

function ThumbnailAndDescription({
  thumbnailURL,
  description,
  datasetDetails,
  publicationName,
  datasetId,
  segmentationThumbnailURL,
}: {
  thumbnailURL: string,
  publicationName: string,
  datasetId: APIDatasetId,
  description: React.Element<*> | string,
  datasetDetails: Object,
  segmentationThumbnailURL: ?string,
}) {
  const details = datasetDetails;
  return (
    <React.Fragment>
      <div className="dataset-description">
        <div className="description-flex">
          <h3 style={{ fontSize: 20 }}>{publicationName}</h3>
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

type Props = { datasets: Array<APIDataset> };
type State = { selectedDataset: APIDataset, hoveredDataset: ?APIDataset };

class PublicationCard extends React.PureComponent<Props, State> {
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

    const descriptionComponent = (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <span style={{ marginBottom: 16 }}>
          <Markdown
            source={publication.description}
            options={{ html: false, breaks: true, linkify: true }}
          />
        </span>
        <div style={{ marginTop: "auto" }}>
          <span style={{ fontSize: 14, textTransform: "uppercase" }}>Published Datasets </span>
          <div className="mini-dataset-thumbnail-grid">
            {datasets.map(dataset => (
              <Button
                className={classNames("mini-dataset-thumbnail", {
                  active: dataset.name === activeDataset.name,
                })}
                key={`${dataset.owningOrganization}/${dataset.name}`}
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
          segmentationThumbnailURL={
            hasSegmentation(activeDataset) ? getSegmentationThumbnailURL(activeDataset) : null
          }
          publicationName={publication.title}
          datasetId={{
            name: activeDataset.name,
            owningOrganization: activeDataset.owningOrganization,
          }}
          description={descriptionComponent}
          datasetDetails={getDetails(activeDataset)}
        />
      </Card>
    );
  }
}

export default PublicationCard;
