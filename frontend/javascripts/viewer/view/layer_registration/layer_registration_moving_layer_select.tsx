import { CheckOutlined } from "@ant-design/icons";
import { Badge, Divider, Flex, Select, Tag, Typography, theme } from "antd";
import { pluralize } from "libs/utils";
import type { VoxelSize } from "types/api_types";
import type { AppliedState } from "./layer_registration_dataset_transforms";
import { formatResidual } from "./layer_registration_helpers";
import type { MovingLayerRow } from "./layer_registration_moving_layers";

function getRowDetails(row: MovingLayerRow, voxelSize: VoxelSize): string {
  if ("isLoading" in row) {
    return row.isLoading ? "Loading…" : "Could not read the landmarks";
  }
  if (row.completePairCount === 0) {
    return "No landmarks yet";
  }
  const pairs = `${row.completePairCount} ${pluralize("pair", row.completePairCount)}`;
  return row.meanResidual != null
    ? `${pairs} · mean error ${formatResidual(row.meanResidual, voxelSize)}`
    : pairs;
}

// Whether the dataset uses the transform of a moving layer. Nothing is shown without a
// transform.
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

// Green for a moving layer that has a transform, gray otherwise.
function TransformBadge({ row }: { row: MovingLayerRow }) {
  const hasTransform = "appliedState" in row && row.appliedState !== "notEnoughPairs";
  return <Badge status={hasTransform ? "success" : "default"} />;
}

function MovingLayerOption({ row, voxelSize }: { row: MovingLayerRow; voxelSize: VoxelSize }) {
  return (
    <Flex justify="space-between" align="center" gap={16}>
      <Flex gap={8} align="baseline">
        <TransformBadge row={row} />
        <Flex vertical>
          <Typography.Text strong>{row.layerName}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {getRowDetails(row, voxelSize)}
          </Typography.Text>
        </Flex>
      </Flex>
      {"appliedState" in row ? <AppliedStateTag appliedState={row.appliedState} /> : null}
    </Flex>
  );
}

/** The line below the panel header: which moving layer is registered to the fixed layer. With
 * several moving layers, the moving layer is a select, and choosing another one switches the
 * right view to it. The tag says whether the dataset uses the transform of the active layer.
 */
export function MovingLayerSelect({
  rows,
  activeLayerName,
  fixedLayerName,
  voxelSize,
  onSelect,
}: {
  rows: MovingLayerRow[];
  activeLayerName: string;
  fixedLayerName: string;
  voxelSize: VoxelSize;
  onSelect: (layerName: string) => void;
}) {
  const { token } = theme.useToken();
  const activeRow = rows.find((row) => row.layerName === activeLayerName);
  const activeIndex = rows.findIndex((row) => row.layerName === activeLayerName);

  return (
    <Flex
      justify="space-between"
      align="center"
      gap={8}
      style={{ padding: `${token.paddingXS}px ${token.paddingSM}px` }}
    >
      <Flex align="center" gap={6} wrap style={{ minWidth: 0 }}>
        <Typography.Text type="secondary">Registering</Typography.Text>
        {rows.length > 1 ? (
          <Select
            size="small"
            value={activeLayerName}
            onChange={onSelect}
            popupMatchSelectWidth={false}
            options={rows.map((row) => ({ value: row.layerName, label: row.layerName }))}
            labelRender={() => (
              <Flex gap={6} align="center">
                {activeRow != null ? <TransformBadge row={activeRow} /> : null}
                <Typography.Text strong>{activeLayerName}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {activeIndex + 1}/{rows.length}
                </Typography.Text>
              </Flex>
            )}
            optionRender={(option) => {
              const row = rows.find(({ layerName }) => layerName === option.value);
              return row != null ? <MovingLayerOption row={row} voxelSize={voxelSize} /> : null;
            }}
            popupRender={(menu) => (
              <>
                <Typography.Text
                  type="secondary"
                  style={{ display: "block", fontSize: 12, padding: "4px 12px" }}
                >
                  Moving layers, registered to {fixedLayerName}
                </Typography.Text>
                {menu}
                <Divider style={{ margin: `${token.marginXXS}px 0` }} />
                <Typography.Text
                  type="secondary"
                  style={{ display: "block", fontSize: 12, padding: "4px 12px", maxWidth: 320 }}
                >
                  Switching reloads both views. To see all layers transformed, use the layer
                  settings of the left view.
                </Typography.Text>
              </>
            )}
          />
        ) : (
          <Typography.Text strong>{activeLayerName}</Typography.Text>
        )}
        <Typography.Text type="secondary">to</Typography.Text>
        <Typography.Text strong>{fixedLayerName}</Typography.Text>
      </Flex>
      {activeRow != null && "appliedState" in activeRow ? (
        <AppliedStateTag appliedState={activeRow.appliedState} />
      ) : null}
    </Flex>
  );
}
