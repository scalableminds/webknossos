import { Button, Select, Space, Typography } from "antd";
import { useState } from "react";
import type { APIDataset } from "types/api_types";

export function LayerPairPicker({
  dataset,
  onPick,
}: {
  dataset: APIDataset;
  onPick: (fixedLayerName: string, movingLayerName: string) => void;
}) {
  const layerNames = dataset.dataSource.dataLayers.map((layer) => layer.name);
  const [fixedLayerName, setFixedLayerName] = useState<string | null>(null);
  const [movingLayerName, setMovingLayerName] = useState<string | null>(null);

  const getOptions = (excludedLayerName: string | null) =>
    layerNames
      .filter((name) => name !== excludedLayerName)
      .map((name) => ({ value: name, label: name }));

  return (
    <div style={{ padding: 24, maxWidth: 480, margin: "40px auto" }}>
      <Typography.Title level={4}>Align two layers of “{dataset.name}”</Typography.Title>
      <Typography.Paragraph>
        Pick the fixed (reference) layer, which stays put, and the moving layer, which will be
        warped onto it.
      </Typography.Paragraph>
      <Space orientation="vertical" style={{ width: "100%" }}>
        <Select
          placeholder="Fixed layer (does not move)"
          style={{ width: "100%" }}
          value={fixedLayerName ?? undefined}
          onChange={setFixedLayerName}
          options={getOptions(movingLayerName)}
        />
        <Select
          placeholder="Moving layer (gets warped)"
          style={{ width: "100%" }}
          value={movingLayerName ?? undefined}
          onChange={setMovingLayerName}
          options={getOptions(fixedLayerName)}
        />
        <Button
          type="primary"
          disabled={fixedLayerName == null || movingLayerName == null}
          onClick={() =>
            fixedLayerName != null &&
            movingLayerName != null &&
            onPick(fixedLayerName, movingLayerName)
          }
        >
          Start aligning
        </Button>
      </Space>
    </div>
  );
}
