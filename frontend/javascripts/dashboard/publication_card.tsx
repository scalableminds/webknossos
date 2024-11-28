import { Card, Button, Tooltip } from "antd";
import { LinkOutlined } from "@ant-design/icons";
import Markdown from "libs/markdown_adapter";
import type React from "react";
import { useState } from "react";
import classNames from "classnames";
import { Link } from "react-router-dom";
import type { APIDataset, APIPublication, APIPublicationAnnotation } from "types/api_flow_types";
import { formatScale } from "libs/format_utils";
import {
  getThumbnailURL,
  hasSegmentation,
  getSegmentationThumbnailURL,
  getDatasetExtentAsString,
} from "oxalis/model/accessors/dataset_accessor";
import { compareBy } from "libs/utils";

type DatasetDetails = {
  species?: string;
  brainRegion?: string;
  acquisition?: string;
};

type ExtendedDatasetDetails = DatasetDetails & {
  name: string;
  scale: string;
  extent: string;
};
const thumbnailDimension = 500;
const miniThumbnailDimension = 75;

enum PublicationItemType {
  ANNOTATION = "ANNOTATION",
  DATASET = "DATASET",
}
type PublicationItem =
  | {
      type: PublicationItemType.ANNOTATION;
      annotation: APIPublicationAnnotation;
      dataset: APIDataset;
    }
  | { type: PublicationItemType.DATASET; dataset: APIDataset };

function getDisplayName(item: PublicationItem): string {
  if (item.type === PublicationItemType.ANNOTATION) {
    return item.annotation.name == null || item.annotation.name === ""
      ? "Unnamed annotation"
      : item.annotation.name;
  }
  return item.dataset.name;
}

function getExtendedDetails(item: PublicationItem): ExtendedDatasetDetails {
  const { dataSource, metadata } = item.dataset;
  const details = {} as DatasetDetails;
  metadata?.forEach((entry) => {
    if (entry.key === "species" || entry.key === "brainRegion" || entry.key === "acquisition") {
      details[entry.key] = entry.value.toString();
    }
  });
  return {
    ...details,
    scale: formatScale(dataSource.scale, 0),
    name: getDisplayName(item),
    extent: getDatasetExtentAsString(item.dataset, false),
  };
}

function getUrl(item: PublicationItem): string {
  return item.type === PublicationItemType.ANNOTATION
    ? `/annotations/${item.annotation.id}`
    : `/datasets/${item.dataset.id}`;
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
  items: Array<PublicationItem>;
  activeItem: PublicationItem;
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
  const sortedItems: Array<PublicationItem> = [
    ...publication.datasets
      .filter((dataset) => dataset.isActive)
      .map((dataset) => ({ type: PublicationItemType.DATASET, dataset }) as PublicationItem),
    ...publication.annotations
      .filter((annotation) => annotation.dataset.isActive)
      .map(
        (annotation) =>
          ({
            type: PublicationItemType.ANNOTATION,
            annotation,
            dataset: annotation.dataset,
          }) as PublicationItem,
      ),
  ];
  sortedItems.sort(compareBy<PublicationItem>((item) => item.dataset.sortingKey));
  const [activeItem, setActiveItem] = useState<PublicationItem | null>(sortedItems[0]);

  return (
    <Card
      styles={{
        body: {
          padding: 0,
        },
      }}
      className="publication-item-card"
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
              <Link to={`/publications/${publication.id}`}>
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
            <Markdown>{publication.description}</Markdown>
          </div>
        </div>
        <PublicationThumbnail
          activeItem={activeItem}
          sortedItems={sortedItems}
          setActiveItem={setActiveItem}
        />
      </div>
    </Card>
  );
}

function PublicationThumbnail({
  activeItem,
  sortedItems,
  setActiveItem,
}: {
  activeItem: PublicationItem | null;
  sortedItems: PublicationItem[];
  setActiveItem: React.Dispatch<React.SetStateAction<PublicationItem | null>>;
}) {
  if (activeItem == null) {
    return <div className="dataset-thumbnail" />;
  }

  const thumbnailURL = getThumbnailURL(activeItem.dataset);
  const segmentationThumbnailURL = hasSegmentation(activeItem.dataset)
    ? getSegmentationThumbnailURL(activeItem.dataset)
    : null;
  const extendedDetails = getExtendedDetails(activeItem);

  return (
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
        <ThumbnailOverlay details={extendedDetails} />
        {sortedItems.length > 1 && (
          <PublishedDatasetsOverlay
            items={sortedItems}
            activeItem={activeItem}
            setActiveItem={setActiveItem}
          />
        )}
      </div>
    </div>
  );
}

export default PublicationCard;
