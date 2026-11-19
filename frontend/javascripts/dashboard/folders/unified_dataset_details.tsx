// Unified datasets prototype (features.unifiedDatasets): the dataset sections of the details
// sidebar. They show the data and annotation layers, the owner and the copy relations.
import { CopyOutlined } from "@ant-design/icons";
import { Flex, Space, Tag, Typography } from "antd";
import {
  AnnotationLayerTag,
  DatasetLayersCell,
} from "dashboard/advanced_dataset/unified_dataset_columns";
import { useDatasetCollectionContext } from "dashboard/dataset/dataset_collection_context";
import { countCopiesBySourceId } from "dashboard/dataset/unified_dataset_list_filters";
import { pluralize } from "libs/utils";
import { useMemo } from "react";
import { Link } from "react-router";
import type { APIDatasetCompact, APIMaybeUnimportedDataset } from "types/api_types";
import { getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import { SidebarSection } from "../sidebar_section";

function LayerList({
  selectedDataset,
  fullDataset,
}: {
  selectedDataset: APIDatasetCompact;
  fullDataset: APIMaybeUnimportedDataset | undefined;
}) {
  if (fullDataset == null || !fullDataset.isActive) {
    // The compact list entry is enough for the layer names.
    return <DatasetLayersCell dataset={selectedDataset} />;
  }
  const layerOrigins = fullDataset.layerOrigins ?? {};
  return (
    <Flex vertical gap={4}>
      {fullDataset.dataSource.dataLayers.map((layer) => {
        const origin = layerOrigins[layer.name];
        return (
          <div key={layer.name}>
            <Tag variant="outlined" style={{ marginInlineEnd: 4 }}>
              {layer.name} - {layer.elementClass}
            </Tag>
            {origin != null ? (
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                linked from{" "}
                {origin.datasetName != null ? (
                  <Link to={getViewDatasetURL({ id: origin.datasetId, name: origin.datasetName })}>
                    {origin.datasetName}
                  </Link>
                ) : (
                  "an unavailable dataset"
                )}
                {origin.layerName !== layer.name ? ` (${origin.layerName})` : null}
              </Typography.Text>
            ) : null}
          </div>
        );
      })}
      <Space size={4} wrap>
        {(selectedDataset.annotationLayers ?? []).map((layer) => (
          <AnnotationLayerTag key={layer.name} layer={layer} />
        ))}
      </Space>
    </Flex>
  );
}

function CopyRelations({
  selectedDataset,
  fullDataset,
}: {
  selectedDataset: APIDatasetCompact;
  fullDataset: APIMaybeUnimportedDataset | undefined;
}) {
  const context = useDatasetCollectionContext();
  const copyCountsBySourceId = useMemo(
    () => countCopiesBySourceId(context.datasets),
    [context.datasets],
  );
  const loadedCopyCount = copyCountsBySourceId.get(selectedDataset.id) ?? 0;
  const copiedFromId = fullDataset?.copiedFrom?.id ?? selectedDataset.copiedFromId;
  const copiedFromName =
    fullDataset?.copiedFrom?.name ??
    context.datasets.find((dataset) => dataset.id === copiedFromId)?.name;
  const hasCopies = loadedCopyCount > 0 || (fullDataset?.copyCount ?? 0) > 0;

  return (
    <>
      {copiedFromId != null ? (
        <SidebarSection label="Copy of">
          {copiedFromName != null ? (
            <Link to={getViewDatasetURL({ id: copiedFromId, name: copiedFromName })}>
              {copiedFromName}
            </Link>
          ) : (
            <Typography.Text type="secondary">A dataset you can't see</Typography.Text>
          )}
        </SidebarSection>
      ) : null}
      {hasCopies ? (
        <SidebarSection label="Copies">
          <div>
            {loadedCopyCount} {pluralize("copy", loadedCopyCount, "copies")} in this list
          </div>
          {context.copiesOfDatasetId !== selectedDataset.id ? (
            <a onClick={() => context.setCopiesOfDatasetId(selectedDataset.id)}>
              <CopyOutlined className="icon-margin-right" />
              Show all copies
            </a>
          ) : null}
        </SidebarSection>
      ) : null}
    </>
  );
}

export function UnifiedDatasetDetailsSections({
  selectedDataset,
  fullDataset,
}: {
  selectedDataset: APIDatasetCompact;
  fullDataset: APIMaybeUnimportedDataset | undefined;
}) {
  const ownerName = fullDataset?.owner?.fullName ?? selectedDataset.ownerName;
  return (
    <>
      <SidebarSection label="Layers">
        <LayerList selectedDataset={selectedDataset} fullDataset={fullDataset} />
      </SidebarSection>
      {ownerName != null ? <SidebarSection label="Owner">{ownerName}</SidebarSection> : null}
      <CopyRelations selectedDataset={selectedDataset} fullDataset={fullDataset} />
    </>
  );
}
