import { Card, Button, Tooltip } from "antd";
import { LinkOutlined } from "@ant-design/icons";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Markdown from "react-remarkable";
import React, { useState } from "react";
import classNames from "classnames";
import { Link } from "react-router-dom";
import type {
  APIDataset,
  APIDatasetDetails,
  APIPublication,
  APIPublicationAnnotation,
} from "types/api_flow_types";
import { formatScale } from "libs/format_utils";
import {
  getThumbnailURL,
  hasSegmentation,
  getSegmentationThumbnailURL,
  getDatasetExtentAsString,
} from "oxalis/model/accessors/dataset_accessor";
import { compareBy } from "libs/utils";
type ExtendedDatasetDetails = APIDatasetDetails & {
  name: string;
  scale: string;
  extent: string;
};
const thumbnailDimension = 500;
const miniThumbnailDimension = 75;

enum AnnotationOrDataset {
  ANNOTATION = "ANNOTATION",
  DATASET = "DATASET",
}
type AnnotationOrDatasetItem =
  | {
      type: AnnotationOrDataset.ANNOTATION;
      annotation: APIPublicationAnnotation;
      dataset: APIDataset;
    }
  | { type: AnnotationOrDataset.DATASET; dataset: APIDataset };

function getDisplayName(item: AnnotationOrDatasetItem): string {
  let displayName = "";
  if (item.type === AnnotationOrDataset.ANNOTATION) {
    displayName = item.annotation.name ?? "";
  }
  if (displayName === "") {
    displayName = item.dataset.displayName ?? "";
  }
  if (displayName === "") {
    displayName = item.dataset.name;
  }
  return displayName;
}

function getDetails(item: AnnotationOrDatasetItem): ExtendedDatasetDetails {
  const { dataSource, details } = item.dataset;
  return {
    ...details,
    scale: formatScale(dataSource.scale, 0),
    name: getDisplayName(item),
    extent: getDatasetExtentAsString(item.dataset, false),
  };
}

function getUrl(item: AnnotationOrDatasetItem): string {
  return item.type === AnnotationOrDataset.ANNOTATION
    ? `/annotations/${item.annotation.id}`
    : `/datasets/${item.dataset.owningOrganization}/${item.dataset.name}`;
}

function ThumbnailOverlay({ details }: { details: ExtendedDatasetDetails }) {
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

type PublishedDatasetsOverlayProps = {
  items: Array<AnnotationOrDatasetItem>;
  activeItem: AnnotationOrDatasetItem;
  setActiveItem: React.Dispatch<any>;
};
function PublishedDatasetsOverlay({
  items,
  activeItem,
  setActiveItem,
}: PublishedDatasetsOverlayProps) {
  return (
    <div className="datasets-scrollbar-spacer">
      <div className="dataset-published-grid nice-scrollbar">
        <div
          className="mini-dataset-thumbnail-grid"
          style={{
            gridTemplateColumns: miniThumbnailDimension,
          }}
        >
          {items.map((item) => {
            const url = getUrl(item);
            return (
              <Link to={url} key={url}>
                <div>
                  <Button
                    className={classNames("mini-dataset-thumbnail", {
                      active: url === getUrl(activeItem),
                    })}
                    title="Click To View"
                    style={{
                      background: `url('${getThumbnailURL(
                        item.dataset,
                      )}?w=${miniThumbnailDimension}&h=${miniThumbnailDimension}')`,
                      width: `${miniThumbnailDimension}px`,
                      height: `${miniThumbnailDimension}px`,
                    }}
                    onMouseEnter={() => setActiveItem(item)}
                  >
                    <div
                      className="mini-dataset-thumbnail absolute segmentation"
                      style={{
                        background: `url('${getSegmentationThumbnailURL(
                          item.dataset,
                        )}?w=${miniThumbnailDimension}&h=${miniThumbnailDimension}')`,
                      }}
                    />
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

type Props = {
  publication: APIPublication;
  showDetailedLink: boolean;
};

function PublicationCard({ publication, showDetailedLink }: Props) {
  const sortedItems: Array<AnnotationOrDatasetItem> = [
    ...publication.datasets.map(
      (dataset) => ({ type: AnnotationOrDataset.DATASET, dataset } as AnnotationOrDatasetItem),
    ),
    ...publication.annotations.map(
      (annotation) =>
        ({
          type: AnnotationOrDataset.ANNOTATION,
          annotation,
          dataset: annotation.dataSet,
        } as AnnotationOrDatasetItem),
    ),
  ];
  sortedItems.sort(
    compareBy([] as Array<AnnotationOrDatasetItem>, (item) => item.dataset.sortingKey),
  );
  const [activeItem, setActiveItem] = useState<AnnotationOrDatasetItem>(sortedItems[0]);
  // This method will only be called for datasets with a publication, but Flow doesn't know that
  if (publication == null) throw Error("Assertion Error: Dataset has no associated publication.");
  const thumbnailURL = getThumbnailURL(activeItem.dataset);
  const segmentationThumbnailURL = hasSegmentation(activeItem.dataset)
    ? getSegmentationThumbnailURL(activeItem.dataset)
    : null;
  const details = getDetails(activeItem);
  return (
    <Card
      bodyStyle={{
        padding: 0,
      }}
      className="spotlight-item-card"
      bordered={false}
    >
      <div
        style={{
          display: "flex",
          height: "100%",
        }}
      >
        <div className="publication-description">
          <h3 className="container-with-hidden-icon">
            {publication.title}
            {showDetailedLink ? (
              <Link to={`/publication/${publication.id}`}>
                <Tooltip title="Open permalink">
                  <LinkOutlined
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
              options={{
                html: false,
                breaks: true,
                linkify: true,
              }}
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
            <Link to={getUrl(activeItem)} className="absolute">
              <div className="dataset-click-hint absolute">Click To View</div>
            </Link>
            <div
              className="dataset-thumbnail-image absolute"
              style={{
                backgroundImage: `url('${thumbnailURL}?w=${thumbnailDimension}&h=${thumbnailDimension}')`,
              }}
            />
            {segmentationThumbnailURL != null && (
              <div
                className="dataset-thumbnail-image absolute segmentation"
                style={{
                  backgroundImage: `url('${segmentationThumbnailURL}?w=${thumbnailDimension}&h=${thumbnailDimension}')`,
                }}
              />
            )}
            <ThumbnailOverlay details={details} />
            {sortedItems.length > 1 && (
              <PublishedDatasetsOverlay
                items={sortedItems}
                activeItem={activeItem}
                setActiveItem={setActiveItem}
              />
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

export default PublicationCard;
