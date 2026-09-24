import { LinkOutlined } from "@ant-design/icons";
import { Button, Card, Flex, Tooltip, Typography } from "antd";
import classNames from "classnames";
import { copyToClipboard } from "libs/clipboard";
import { formatScale } from "libs/format_utils";
import Markdown from "libs/markdown_adapter";
import { compareBy, pluralize } from "libs/utils";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { APIDataset, APIPublication, APIPublicationAnnotation } from "types/api_types";
import {
  getSegmentationThumbnailURL,
  getThumbnailURL,
  hasSegmentation,
} from "viewer/model/accessors/dataset_accessor";

type DatasetDetails = {
  species?: string;
  brainRegion?: string;
};

type ExtendedDatasetDetails = DatasetDetails & {
  name: string;
  scale: string;
};
const thumbnailDimension = 500;
const listThumbnailDimension = 56;
const collapsedItemCount = 3;

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
    if (entry.key === "species" || entry.key === "brainRegion") {
      details[entry.key] = entry.value.toString();
    }
  });

  return {
    ...details,
    scale: formatScale(dataSource.scale, 0),
    name: getDisplayName(item),
  };
}

function getUrl(item: PublicationItem): string {
  return item.type === PublicationItemType.ANNOTATION
    ? `/annotations/${item.annotation.id}`
    : `/datasets/${item.dataset.id}`;
}

function getItemCountLabel(items: Array<PublicationItem>): string {
  const annotationCount = items.filter(
    (item) => item.type === PublicationItemType.ANNOTATION,
  ).length;
  const datasetCount = items.length - annotationCount;
  return [
    datasetCount > 0 ? `${datasetCount} ${pluralize("dataset", datasetCount)}` : null,
    annotationCount > 0 ? `${annotationCount} ${pluralize("annotation", annotationCount)}` : null,
  ]
    .filter((part) => part != null)
    .join(" · ");
}

/** Active datasets and annotations on active datasets, sorted by the datasets' sorting key. */
function usePublicationItems(publication: APIPublication): Array<PublicationItem> {
  return useMemo(() => {
    const items: Array<PublicationItem> = [
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
    return items.sort(compareBy<PublicationItem>((item) => item.dataset.sortingKey));
  }, [publication]);
}

function PermalinkButton({ publicationId }: { publicationId: string }) {
  return (
    <Tooltip title="Copy permalink">
      <Button
        type="text"
        className="publication-permalink"
        icon={<LinkOutlined />}
        aria-label="Copy permalink"
        onClick={() =>
          copyToClipboard(`${window.location.origin}/publications/${publicationId}`, "link")
        }
      />
    </Tooltip>
  );
}

type PublicationItemListProps = {
  items: Array<PublicationItem>;
  activeItem: PublicationItem | null;
  setActiveItem: (item: PublicationItem) => void;
  defaultExpanded: boolean;
};

function PublicationItemList({
  items,
  activeItem,
  setActiveItem,
  defaultExpanded,
}: PublicationItemListProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const hiddenItemCount = items.length - collapsedItemCount;
  const visibleItems = isExpanded ? items : items.slice(0, collapsedItemCount);

  return (
    <Flex orientation="vertical" gap="small" className="publication-item-list">
      <Typography.Text strong>{getItemCountLabel(items)}</Typography.Text>
      {visibleItems.map((item) => {
        const url = getUrl(item);
        return (
          <Link
            to={url}
            key={url}
            className={classNames("publication-item-row", {
              active: activeItem != null && url === getUrl(activeItem),
            })}
            onMouseEnter={() => setActiveItem(item)}
          >
            <img
              src={`${getThumbnailURL(item.dataset)}?w=${listThumbnailDimension}&h=${listThumbnailDimension}`}
              alt=""
            />
            <Typography.Text ellipsis className="publication-item-row-name">
              {getDisplayName(item)}
            </Typography.Text>
            {item.type === PublicationItemType.ANNOTATION && (
              <Typography.Text type="secondary" style={{ fontSize: 12, flex: "none" }}>
                annotation
              </Typography.Text>
            )}
          </Link>
        );
      })}
      {hiddenItemCount > 0 && (
        <Button
          type="link"
          className="publication-item-list-toggle"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? "Show less" : `+ ${hiddenItemCount} more`}
        </Button>
      )}
    </Flex>
  );
}

function PublicationPreviewCaption({ item }: { item: PublicationItem }) {
  const { name, species, brainRegion, scale } = getExtendedDetails(item);
  const origin = [species && <b key="species">{species}</b>, brainRegion]
    .filter(Boolean)
    .flatMap((part, index) => (index > 0 ? [" ", part] : [part]));

  return (
    <Flex align="center" gap="medium" className="publication-preview-caption">
      <Flex orientation="vertical" style={{ flex: 1, minWidth: 0 }}>
        <div className="publication-preview-caption-name">{name}</div>
        <div className="publication-preview-caption-meta">
          {origin}
          {origin.length > 0 && " · "}
          {scale}
        </div>
      </Flex>
      <Link to={getUrl(item)}>
        <Button type="primary">
          {item.type === PublicationItemType.ANNOTATION ? "View annotation" : "View dataset"}
        </Button>
      </Link>
    </Flex>
  );
}

function PublicationPreview({ item }: { item: PublicationItem | null }) {
  if (item == null) {
    return <div className="publication-preview" />;
  }

  const imageSize = `?w=${thumbnailDimension}&h=${thumbnailDimension}`;
  return (
    <div className="publication-preview">
      <img src={`${getThumbnailURL(item.dataset)}${imageSize}`} alt="" />
      {hasSegmentation(item.dataset) && (
        <img
          src={`${getSegmentationThumbnailURL(item.dataset)}${imageSize}`}
          alt=""
          className="segmentation"
        />
      )}
      <PublicationPreviewCaption item={item} />
    </div>
  );
}

type Props = {
  publication: APIPublication;
  showDetailedLink: boolean;
  defaultExpanded?: boolean;
};

function PublicationCard({ publication, showDetailedLink, defaultExpanded = false }: Props) {
  const sortedItems = usePublicationItems(publication);
  const [activeItem, setActiveItem] = useState<PublicationItem | null>(sortedItems[0]);

  return (
    <Card
      styles={{
        body: {
          padding: 0,
        },
      }}
      className="publication-item-card"
      variant="borderless"
    >
      <Flex orientation="vertical" gap="small" className="publication-description">
        <Flex gap="small" align="flex-start">
          <Typography.Title level={3} className="publication-title">
            {publication.title}
          </Typography.Title>
          {showDetailedLink && <PermalinkButton publicationId={publication.id} />}
        </Flex>
        <div className="publication-description-body">
          <Markdown>{publication.description}</Markdown>
        </div>
        {sortedItems.length > 1 && (
          <PublicationItemList
            items={sortedItems}
            activeItem={activeItem}
            setActiveItem={setActiveItem}
            defaultExpanded={defaultExpanded}
          />
        )}
      </Flex>
      <PublicationPreview item={activeItem} />
    </Card>
  );
}

export default PublicationCard;
