// Unified datasets prototype (features.unifiedDatasets): the additional columns of the dataset list.
import { HighlightOutlined, NodeIndexOutlined } from "@ant-design/icons";
import { Space, Tag, Typography } from "antd";
import type { ColumnType } from "antd/es/table/interface";
import FastTooltip from "components/fast_tooltip";
import FormattedDate from "components/formatted_date";
import { AnnotationLayerEnum, type APIDatasetCompact } from "types/api_types";

// A fixed maximum width (not a percentage), so that long layer names don't widen the table column.
const TAG_STYLE = {
  maxWidth: 140,
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
  marginInlineEnd: 0,
} as const;

type AnnotationLayer = NonNullable<APIDatasetCompact["annotationLayers"]>[number];

export function AnnotationLayerTag({ layer }: { layer: AnnotationLayer }) {
  const isSkeleton = layer.typ === AnnotationLayerEnum.Skeleton;
  return (
    <FastTooltip title={isSkeleton ? "Skeleton annotation layer" : "Volume annotation layer"}>
      <Tag
        color={isSkeleton ? "green" : "purple"}
        icon={isSkeleton ? <NodeIndexOutlined /> : <HighlightOutlined />}
        style={TAG_STYLE}
      >
        {layer.name}
      </Tag>
    </FastTooltip>
  );
}

// The data layer tags followed by distinct tags for the skeleton and volume annotation layers.
export function DatasetLayersCell({ dataset }: { dataset: APIDatasetCompact }) {
  const dataLayerNames = dataset.isActive
    ? [...dataset.colorLayerNames, ...dataset.segmentationLayerNames]
    : [];
  return (
    <Space size={4} wrap>
      {dataLayerNames.map((layerName) => (
        <Tag key={`data-${layerName}`} variant="outlined" style={TAG_STYLE} title={layerName}>
          {layerName}
        </Tag>
      ))}
      {(dataset.annotationLayers ?? []).map((layer) => (
        <AnnotationLayerTag key={`annotation-${layer.name}`} layer={layer} />
      ))}
    </Space>
  );
}

// Shown below the name of a copy when copies aren't grouped below their source.
export function CopyOfHint({ sourceName }: { sourceName: string | null }) {
  return (
    <div>
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        {sourceName != null ? `copy of ${sourceName}` : "copy"}
      </Typography.Text>
    </div>
  );
}

// The Layers, Owner and Last modified columns. Rows that aren't datasets (i.e., folders) stay empty.
export function getUnifiedDatasetColumns<Row>(
  getDataset: (row: Row) => APIDatasetCompact | null,
): ColumnType<Row>[] {
  return [
    {
      title: "Layers",
      key: "layers",
      render: (_value, row) => {
        const dataset = getDataset(row);
        return dataset != null ? <DatasetLayersCell dataset={dataset} /> : null;
      },
    },
    {
      title: "Owner",
      key: "owner",
      width: 110,
      render: (_value, row) => getDataset(row)?.ownerName ?? null,
    },
    {
      title: "Last modified",
      key: "modified",
      width: 110,
      render: (_value, row) => {
        const dataset = getDataset(row);
        return dataset != null ? (
          <FormattedDate timestamp={dataset.modified ?? dataset.created} />
        ) : null;
      },
    },
  ];
}
