// Muted line below a layer name in the unified datasets prototype (features.unifiedDatasets) that
// tells where a layer comes from: a linked data layer of another dataset, or a volume layer that
// extends a segmentation layer. Layers native to the dataset get no line.
import { Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import type { ReactNode } from "react";
import { getDataLayers } from "viewer/model/accessors/dataset_accessor";
import { isUnifiedDatasetView } from "viewer/model/accessors/unified_dataset_accessor";

function OriginText({ children }: { children: ReactNode }) {
  return (
    <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, fontWeight: 400 }}>
      {children}
    </Typography.Text>
  );
}

export default function LayerOriginLine({ layerName }: { layerName: string }) {
  const isUnifiedView = useWkSelector(isUnifiedDatasetView);
  const origin = useWkSelector((state) => state.dataset.layerOrigins?.[layerName]);
  const fallbackLayerName = useWkSelector((state) => {
    const layer = getDataLayers(state.dataset).find((l) => l.name === layerName);
    return layer?.category === "segmentation" && layer.tracingId != null
      ? (layer.fallbackLayer ?? null)
      : null;
  });

  if (!isUnifiedView) {
    return null;
  }
  if (fallbackLayerName != null) {
    return <OriginText>extends {fallbackLayerName}</OriginText>;
  }
  if (origin == null) {
    return null;
  }
  return (
    <OriginText>
      linked from{" "}
      {origin.datasetName != null ? (
        <a href={`/datasets/${origin.datasetId}/view`}>{origin.datasetName}</a>
      ) : (
        "deleted dataset"
      )}
    </OriginText>
  );
}
