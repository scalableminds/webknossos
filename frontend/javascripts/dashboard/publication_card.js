// @flow
import { Card, Button, Tooltip, Icon } from "antd";
import Markdown from "react-remarkable";
import React, { useState } from "react";
import classNames from "classnames";
import { Link } from "react-router-dom";

import type { APIDataset, APIDatasetDetails } from "admin/api_flow_types";
import { formatScale } from "libs/format_utils";
import {
  getThumbnailURL,
  hasSegmentation,
  getSegmentationThumbnailURL,
  getDatasetExtentAsString,
} from "oxalis/model/accessors/dataset_accessor";
import { compareBy } from "libs/utils";

type ExtendedDatasetDetails = { ...APIDatasetDetails, name: string, scale: string, extent: string };

const thumbnailDimension = 500;
const miniThumbnailDimension = 75;
const blacklistedSegmentationNames = ["2012-09-28_ex145_07x2_ROI2017"];

function getDisplayName(dataset: APIDataset): string {
  return dataset.displayName != null && dataset.displayName !== ""
    ? dataset.displayName
    : dataset.name;
}

function getDetails(dataset: APIDataset): ExtendedDatasetDetails {
  const { dataSource, details } = dataset;
  return {
    ...details,
    scale: formatScale(dataSource.scale, 0),
    name: getDisplayName(dataset),
    extent: getDatasetExtentAsString(dataset, false),
  };
}

function ThumbnailOverlay({ details }) {
  return (
    <div className="dataset-thumbnail-overlay">
      <div>
        {details.species && (
          <div
            style={{
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
      <div
        style={{
          fontSize: 18,
        }}
      >
        {details.name}
      </div>
      <div
        style={{
          marginTop: "auto",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          color: "rgba(200,200,200,0.85)",
        }}
      >
        <div>{details.acquisition}</div>
        <div>
          {details.scale}
          <br />
          {details.extent}
        </div>
      </div>
    </div>
  );
}

function PublishedDatasetsOverlay({ datasets, activeDataset, setActiveDataset }) {
  return (
    <div className="datasets-scrollbar-spacer">
      <div className="dataset-published-grid nice-scrollbar">
        <div
          className="mini-dataset-thumbnail-grid"
          style={{
            gridTemplateColumns: miniThumbnailDimension,
          }}
        >
          {datasets.map(dataset => {
            const datasetIdString = `${dataset.owningOrganization}/${dataset.name}`;
            return (
              <Link to={`/datasets/${datasetIdString}/view`} key={datasetIdString}>
                <div>
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
                    onMouseEnter={() => setActiveDataset(dataset)}
                  >
                    {!blacklistedSegmentationNames.includes(dataset.name) && (
                      <div
                        className="mini-dataset-thumbnail absolute segmentation"
                        style={{
                          background: `url('${getSegmentationThumbnailURL(
                            dataset,
                          )}?w=${miniThumbnailDimension}&h=${miniThumbnailDimension}')`,
                        }}
                      />
                    )}
                  </Button>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const typeHint: Array<APIDataset> = [];

type Props = { datasets: Array<APIDataset>, showDetailedLink: boolean };

function PublicationCard({ datasets, showDetailedLink }: Props) {
  const sortedDatasets = datasets.sort(compareBy(typeHint, dataset => dataset.sortingKey));
  const [activeDataset, setActiveDataset] = useState<APIDataset>(sortedDatasets[0]);

  const { publication } = activeDataset;
  // This method will only be called for datasets with a publication, but Flow doesn't know that
  if (publication == null) throw Error("Assertion Error: Dataset has no associated publication.");

  const thumbnailURL = getThumbnailURL(activeDataset);
  const segmentationThumbnailURL = hasSegmentation(activeDataset)
    ? getSegmentationThumbnailURL(activeDataset)
    : null;
  const details = getDetails(activeDataset);

  return (
    <Card bodyStyle={{ padding: 0 }} className="spotlight-item-card" bordered={false}>
      <div style={{ display: "flex", height: "100%" }}>
        <div className="publication-description">
          <h3 className="container-with-hidden-icon">
            {publication.title}
            {showDetailedLink ? (
              <Link to={`/publication/${publication.id}`}>
                <Tooltip title="Open permalink">
                  <Icon
                    type="link"
                    style={{
                      fontSize: 16,
                      color: "#555",
                      marginBottom: 18,
                      marginLeft: 8,
                    }}
                    className="hidden-icon"
                  />
                </Tooltip>
              </Link>
            ) : null}
          </h3>
          <div className="publication-description-body nice-scrollbar">
            <Markdown
              source={publication.description}
              options={{ html: false, breaks: true, linkify: true }}
            />
          </div>
        </div>
        <div className="dataset-thumbnail">
          <div
            style={{
              position: "relative",
              height: "100%",
              display: "flex",
              alignItems: "flex-end",
            }}
          >
            <Link
              to={`/datasets/${activeDataset.owningOrganization}/${activeDataset.name}/view`}
              className="absolute"
            >
              <div className="dataset-click-hint absolute">Click To View</div>
            </Link>
            <div
              className="dataset-thumbnail-image absolute"
              style={{
                backgroundImage: `url('${thumbnailURL}?w=${thumbnailDimension}&h=${thumbnailDimension}')`,
              }}
            />
            {!blacklistedSegmentationNames.includes(activeDataset.name) &&
            segmentationThumbnailURL ? (
              <div
                className="dataset-thumbnail-image absolute segmentation"
                style={{
                  backgroundImage: `url('${segmentationThumbnailURL}?w=${thumbnailDimension}&h=${thumbnailDimension}')`,
                }}
              />
            ) : null}
            <ThumbnailOverlay details={details} />
            {sortedDatasets.length > 1 && (
              <PublishedDatasetsOverlay
                datasets={sortedDatasets}
                activeDataset={activeDataset}
                setActiveDataset={setActiveDataset}
              />
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

export default PublicationCard;
