// @flow
import { Card, Button, Tag } from "antd";
import Markdown from "react-remarkable";
import * as React from "react";
import classNames from "classnames";
import { Link } from "react-router-dom";
import moment from "moment";

import type { APIDataset, APIDatasetId, APIDatasetDetails } from "admin/api_flow_types";
import { formatScale } from "libs/format_utils";
import {
  getThumbnailURL,
  hasSegmentation,
  getSegmentationThumbnailURL,
} from "oxalis/model/accessors/dataset_accessor";
import {
  formatExtentWithLength,
  getDatasetExtentInLength,
  formatNumberToLength,
} from "oxalis/view/right-menu/dataset_info_tab_view";
import { compareBy } from "libs/utils";

type ExtendedDatasetDetails = { ...APIDatasetDetails, name: string, scale: string, extent: string };

const thumbnailDimension = 500;
const miniThumbnailDimension = 75;

function getDisplayName(dataset: APIDataset): string {
  return dataset.displayName != null && dataset.displayName !== ""
    ? dataset.displayName
    : dataset.name;
}

function getDetails(dataset: APIDataset): ExtendedDatasetDetails {
  const { dataSource, details } = dataset;
  return {
    ...details,
    scale: formatScale(dataSource.scale),
    name: getDisplayName(dataset),
    extent: formatExtentWithLength(getDatasetExtentInLength(dataset), formatNumberToLength),
  };
}

function ThumbnailAndDescription({
  thumbnailURL,
  description,
  datasetDetails,
  publicationName,
  publicationDate,
  datasetId,
  segmentationThumbnailURL,
}: {
  thumbnailURL: string,
  publicationName: string,
  publicationDate: number,
  datasetId: APIDatasetId,
  description: React.Element<*> | string,
  datasetDetails: ExtendedDatasetDetails,
  segmentationThumbnailURL: ?string,
}) {
  const details = datasetDetails;
  return (
    <React.Fragment>
      <div className="dataset-description">
        <div className="description-flex">
          <div>
            <Tag>{datasetId.owningOrganization}</Tag>
            <span style={{ float: "right" }}>{moment(publicationDate).format("MMMM Do YYYY")}</span>
          </div>
          <h3 style={{ fontSize: 20 }}>{publicationName}</h3>
          <div className="dataset-description-body">{description}</div>
        </div>
      </div>
      <span className="dataset-thumbnail">
        <Link to={`/datasets/${datasetId.owningOrganization}/${datasetId.name}/view`}>
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
              {details.brainRegion && (
                <div
                  style={{
                    display: "inline",
                    marginLeft: 5,
                  }}
                >
                  {details.brainRegion}
                </div>
              )}
            </div>
            <div style={{ marginTop: "auto" }}>
              {details.acquisition && (
                <div style={{ display: "inline-block", color: "rgba(200,200,200,0.85)" }}>
                  {details.acquisition}
                </div>
              )}
              <span style={{ float: "right", color: "rgba(200,200,200,0.85)" }}>
                Scale: {details.scale}
                <br />
                Extent: {details.extent}
              </span>
            </div>
          </div>
        </Link>
      </span>
    </React.Fragment>
  );
}

const typeHint: Array<APIDataset> = [];

type Props = { datasets: Array<APIDataset> };
type State = { activeDataset: APIDataset };

class PublicationCard extends React.PureComponent<Props, State> {
  state = {
    activeDataset: this.props.datasets[0],
  };

  render() {
    const { datasets } = this.props;
    const { activeDataset } = this.state;
    const { publication } = activeDataset;
    // This method will only be called for datasets with a publication, but Flow doesn't know that
    if (publication == null) throw Error("Assertion Error: Dataset has no associated publication.");

    const sortedDatasets = datasets.sort(compareBy(typeHint, dataset => dataset.sortingKey));

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
          <div
            className="mini-dataset-thumbnail-grid"
            style={{ gridTemplateColumns: `repeat(auto-fill, ${miniThumbnailDimension}px)` }}
          >
            {sortedDatasets.map(dataset => {
              const datasetIdString = `${dataset.owningOrganization}/${dataset.name}`;
              return (
                <Link to={`/datasets/${datasetIdString}/view`} key={datasetIdString}>
                  <Button
                    className={classNames("mini-dataset-thumbnail", {
                      active: dataset.name === activeDataset.name,
                    })}
                    title="Click To View"
                    style={{
                      background: `url('${getThumbnailURL(
                        dataset,
                      )}?w=${miniThumbnailDimension}&h=${miniThumbnailDimension}')`,
                      width: `${miniThumbnailDimension}px`,
                      height: `${miniThumbnailDimension}px`,
                    }}
                    onMouseEnter={() => this.setState({ activeDataset: dataset })}
                  >
                    <div
                      className="mini-dataset-thumbnail segmentation"
                      style={{
                        background: `url('${getSegmentationThumbnailURL(
                          dataset,
                        )}?w=${miniThumbnailDimension}&h=${miniThumbnailDimension}')`,
                      }}
                    />
                  </Button>
                </Link>
              );
            })}
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
          publicationDate={publication.publicationDate}
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
