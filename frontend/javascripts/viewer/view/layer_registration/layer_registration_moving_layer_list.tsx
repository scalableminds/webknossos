import { CheckOutlined } from "@ant-design/icons";
import { Flex, Select, Space, Tag, Typography } from "antd";
import classnames from "classnames";
import { AsyncButton } from "components/async_clickables";
import { SidebarSection } from "dashboard/sidebar_section";
import { pluralize } from "libs/utils";
import { useState } from "react";
import type { VoxelSize } from "types/api_types";
import { type AppliedState, formatResidual } from "./layer_registration_helpers";

// The state of the estimated transform of one moving layer. Without counts, its landmarks are still
// loading (isLoading) or could not be read.
export type MovingLayerRow = { layerName: string } & (
  | { completePairCount: number; meanResidual: number | null; appliedState: AppliedState }
  | { isLoading: boolean }
);

// A moving layer whose fixed layer landmarks can be copied to the active moving layer.
export type CopySource = { layerName: string; landmarkCount: number };

function getRowDetails(row: MovingLayerRow, voxelSize: VoxelSize): string {
  if ("isLoading" in row) {
    return row.isLoading ? "Loading…" : "Could not read the landmarks";
  }
  const pairs = `${row.completePairCount} ${pluralize("pair", row.completePairCount)}`;
  return row.meanResidual != null
    ? `${pairs} · mean error ${formatResidual(row.meanResidual, voxelSize)}`
    : pairs;
}

function AppliedStateTag({ appliedState }: { appliedState: AppliedState }) {
  switch (appliedState) {
    case "applied":
      return (
        <Tag color="success" icon={<CheckOutlined />} style={{ marginInlineEnd: 0 }}>
          Applied
        </Tag>
      );
    case "notApplied":
      return <Tag style={{ marginInlineEnd: 0 }}>Not applied</Tag>;
    case "notEnoughPairs":
      return null;
  }
}

// Lists the moving layers with the state of their transforms. Clicking a layer shows it in the
// right view.
export function LayerRegistrationMovingLayerList({
  rows,
  activeLayerName,
  voxelSize,
  onSelect,
}: {
  rows: MovingLayerRow[];
  activeLayerName: string;
  voxelSize: VoxelSize;
  onSelect: (layerName: string) => void;
}) {
  return (
    <SidebarSection label="Layers">
      <Flex vertical gap={4} style={{ alignSelf: "stretch" }}>
        {rows.map((row) => {
          const isActive = row.layerName === activeLayerName;
          return (
            <button
              key={row.layerName}
              type="button"
              className={classnames("moving-layer-row", { "is-active": isActive })}
              aria-current={isActive ? "true" : undefined}
              onClick={() => onSelect(row.layerName)}
            >
              <Flex justify="space-between" align="center" gap={8}>
                <Flex vertical align="start">
                  <Typography.Text strong={isActive}>{row.layerName}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {getRowDetails(row, voxelSize)}
                  </Typography.Text>
                </Flex>
                {"appliedState" in row ? <AppliedStateTag appliedState={row.appliedState} /> : null}
              </Flex>
            </button>
          );
        })}
      </Flex>
      <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
        Click a layer to place its landmarks in the right view. To see all layers transformed, show
        them in the layer settings of the left view.
      </Typography.Text>
    </SidebarSection>
  );
}

// Offers to start the active moving layer with the fixed layer landmarks of another moving
// layer. The right view then asks for the partner of each of them.
export function CopyLandmarksOffer({
  fixedLayerName,
  sources,
  onCopy,
}: {
  fixedLayerName: string;
  sources: CopySource[];
  onCopy: (sourceLayerName: string) => Promise<void>;
}) {
  const [sourceLayerName, setSourceLayerName] = useState<string | null>(null);
  const selectedSource =
    sources.find((source) => source.layerName === sourceLayerName) ?? sources[0];
  if (selectedSource == null) {
    return null;
  }
  return (
    <Flex vertical gap={8} className="copy-landmarks-offer">
      <Typography.Text strong>Reuse landmarks of another layer</Typography.Text>
      <Typography.Text>
        Copy the landmarks that "{fixedLayerName}" has for another layer. The right view then asks
        for the matching spot of each one.
      </Typography.Text>
      <Space.Compact block>
        <Select
          value={selectedSource.layerName}
          onChange={setSourceLayerName}
          options={sources.map(({ layerName, landmarkCount }) => ({
            value: layerName,
            label: `${layerName} (${landmarkCount} ${pluralize("landmark", landmarkCount)})`,
          }))}
          // Takes the width that the button leaves free.
          style={{ flex: 1, minWidth: 0 }}
        />
        <AsyncButton onClick={() => onCopy(selectedSource.layerName)}>Copy</AsyncButton>
      </Space.Compact>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Delete the landmarks that can't be found in this layer.
      </Typography.Text>
    </Flex>
  );
}
