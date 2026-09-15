import { CloseOutlined, DatabaseOutlined } from "@ant-design/icons";
import { Popover, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { Model } from "viewer/singletons";
import ButtonComponent from "viewer/view/components/button_component";

const POLL_INTERVAL_MS = 2000;

type LayerBucketStats = {
  layerName: string;
  ramBucketCount: number;
  ramBucketLimit: number;
  gpuBucketCount: number;
  gpuBucketCapacity: number;
};

// Lightweight, poll-based (not Redux-driven) snapshot of how many buckets
// each layer currently holds in CPU RAM (DataCube.buckets) vs. how many are
// actually committed into a GPU texture pool slot (TextureBucketManager),
// plus that GPU slot's total capacity. Useful for debugging the per-layer
// bucket budget scaling (see getRequiredBucketCapacityPerLayer /
// getBucketCountSoftLimitPerLayer in data_rendering_logic.ts).
function collectLayerBucketStats(): LayerBucketStats[] {
  return Model.getAllLayers().map((dataLayer) => {
    // Lazily created on first render; may not exist yet for a layer that
    // has never been drawn.
    const textureBucketManager = dataLayer.layerRenderingManager.textureBucketManager;
    return {
      layerName: dataLayer.name,
      ramBucketCount: dataLayer.cube.buckets.length,
      ramBucketLimit: dataLayer.cube.BUCKET_COUNT_SOFT_LIMIT,
      gpuBucketCount: textureBucketManager?.activeBucketToIndexMap.size ?? 0,
      gpuBucketCapacity: textureBucketManager?.maximumCapacity ?? 0,
    };
  });
}

const columns: ColumnsType<LayerBucketStats> = [
  {
    title: "Layer",
    dataIndex: "layerName",
    key: "layerName",
  },
  {
    title: "RAM buckets",
    key: "ram",
    render: (_, record) => `${record.ramBucketCount} / ${record.ramBucketLimit}`,
  },
  {
    title: "GPU buckets",
    key: "gpu",
    render: (_, record) => `${record.gpuBucketCount} / ${record.gpuBucketCapacity}`,
  },
];

export default function LayerBucketInspector() {
  const [isOpen, setIsOpen] = useState(false);
  const [stats, setStats] = useState<LayerBucketStats[]>([]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setStats(collectLayerBucketStats());
    const intervalId = setInterval(() => {
      setStats(collectLayerBucketStats());
    }, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [isOpen]);

  return (
    <Popover
      open={isOpen}
      // Fully controlled: only setIsOpen (the trigger button and the X
      // button below) can open/close this, never a hover or outside click.
      trigger={[]}
      placement="bottomRight"
      content={
        <div style={{ width: 380 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <Typography.Text strong>Layer Bucket Usage</Typography.Text>
            <ButtonComponent
              variant="text"
              color="default"
              size="small"
              icon={<CloseOutlined />}
              onClick={() => setIsOpen(false)}
            />
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="layerName"
            dataSource={stats}
            columns={columns}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Refreshes every {POLL_INTERVAL_MS / 1000}s while open. RAM = buckets held in CPU memory;
            GPU = buckets committed into a texture pool slot for this layer.
          </Typography.Text>
        </div>
      }
    >
      <ButtonComponent
        variant="text"
        color="default"
        size="small"
        icon={<DatabaseOutlined />}
        title="Inspect per-layer bucket usage (RAM vs. GPU)"
        onClick={() => setIsOpen(!isOpen)}
      />
    </Popover>
  );
}
