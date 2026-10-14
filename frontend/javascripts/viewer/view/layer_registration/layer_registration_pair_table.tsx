import { CopyOutlined, DeleteOutlined } from "@ant-design/icons";
import {
  Badge,
  Button,
  Card,
  Flex,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Table,
  Tooltip,
  Typography,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { AsyncButton } from "components/async_clickables";
import { pluralize } from "libs/utils";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { VoxelSize } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import {
  formatResidual,
  getLandmarkTreeName,
  isCompletePair,
  isHighResidual,
  type LandmarkPair,
  type LayerNames,
  SIDES,
  type Side,
} from "./layer_registration_helpers";

// A moving layer whose fixed layer landmarks can be copied to the active moving layer.
export type CopySource = { layerName: string; landmarkCount: number };

type SortKey = "pair" | "error";

// The table header of antd's small table, needed to compute the height of the table body.
const TABLE_HEADER_HEIGHT = 39;
// From this table width on, the landmark columns show the coordinates next to the colors.
const WIDE_TABLE_MIN_WIDTH = 456;
// Below this table width, the z column and the error bars are left out.
const NARROW_TABLE_MAX_WIDTH = 300;
const VIEW_NAMES: Record<Side, string> = { fixed: "left", moving: "right" };
// Used to estimate the width that the pair column needs: the horizontal padding of a cell of
// antd's small table, and the width of a character in the table's font.
const CELL_PADDING = 16;
const LABEL_CHAR_WIDTH = 8;

function getLabelWidth(label: string): number {
  return label.length * LABEL_CHAR_WIDTH + CELL_PADDING;
}

export function rgbColorString(color: Vector3): string {
  return `rgb(${color.map((component) => Math.round(component * 255)).join(",")})`;
}

// The color that both landmarks of a pair have in the views. The ring keeps light and dark colors
// visible in both themes.
export function LandmarkColorDot({ color, hasGap = true }: { color: Vector3; hasGap?: boolean }) {
  return (
    <span
      className="landmark-color"
      style={{ background: rgbColorString(color), marginRight: hasGap ? undefined : 0 }}
    />
  );
}

// The current size of the element that the returned ref is attached to.
function useElementSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (element == null) {
      return;
    }
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

// Pairs without an error (incomplete pairs, or no transform) stay at the end.
function sortPairs(pairs: LandmarkPair[], sortKey: SortKey): LandmarkPair[] {
  if (sortKey === "pair") {
    // getLandmarkPairs already sorts by pair id.
    return pairs;
  }
  return pairs.toSorted((a, b) => {
    if (a.residual == null || b.residual == null) {
      return (a.residual == null ? 1 : 0) - (b.residual == null ? 1 : 0);
    }
    return b.residual - a.residual;
  });
}

function MissingLandmarkMarker({ side }: { side: Side }) {
  return (
    <Tooltip title={`No landmark in the ${VIEW_NAMES[side]} view yet.`}>
      <Typography.Text type="warning" style={{ fontSize: 12 }}>
        missing
      </Typography.Text>
    </Tooltip>
  );
}

// The error of a pair as a length, and a bar whose width is relative to the largest error.
function ResidualCell({
  residual,
  isHigh,
  maxResidual,
  showBar,
  voxelSize,
}: {
  residual: number;
  isHigh: boolean;
  maxResidual: number;
  showBar: boolean;
  voxelSize: VoxelSize;
}) {
  const { token } = theme.useToken();
  return (
    <Flex align="center" gap={6}>
      <span
        style={{
          fontSize: 12,
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
          fontWeight: isHigh ? token.fontWeightStrong : undefined,
          color: isHigh ? token.colorWarningText : undefined,
        }}
      >
        {formatResidual(residual, voxelSize)}
      </span>
      {showBar ? (
        <span
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            background: token.colorFillSecondary,
            overflow: "hidden",
          }}
        >
          <span
            style={{
              display: "block",
              height: "100%",
              width: `${maxResidual > 0 ? (residual / maxResidual) * 100 : 0}%`,
              background: isHigh ? token.colorWarning : token.colorTextTertiary,
            }}
          />
        </span>
      ) : null}
    </Flex>
  );
}

function getPairColumns({
  tableWidth,
  layerNames,
  voxelSize,
  meanResidual,
  maxResidual,
  maxPairId,
  onDeletePair,
}: {
  tableWidth: number;
  layerNames: LayerNames;
  voxelSize: VoxelSize;
  meanResidual: number | null;
  maxResidual: number;
  maxPairId: number;
  onDeletePair: (pair: LandmarkPair) => void;
}): ColumnsType<LandmarkPair> {
  const isWide = tableWidth >= WIDE_TABLE_MIN_WIDTH;
  const isNarrow = tableWidth < NARROW_TABLE_MAX_WIDTH;
  const showZ = !isWide && !isNarrow;
  // The pair column shows "Landmark 12" if there is room for the longest name, and only the
  // number otherwise. A cut-off name would hide the number.
  const fullLabelWidth = getLabelWidth(getLandmarkTreeName(maxPairId));
  const numberLabelWidth = Math.max(getLabelWidth(String(maxPairId)), 36);
  // The virtualized table needs fixed column widths. Without coordinates, the pair column takes
  // the rest. The landmark columns are wide enough for their titles in one line.
  const widths = {
    landmark: isWide ? 0 : isNarrow ? 36 : 52,
    z: 52,
    residual: isNarrow ? 64 : isWide ? 116 : 108,
    delete: isNarrow ? 32 : 36,
  };
  const pairWidth = isWide ? Math.max(fullLabelWidth, 96) : 0;
  if (isWide) {
    widths.landmark = Math.max(
      120,
      Math.floor((tableWidth - pairWidth - widths.residual - widths.delete) / 2),
    );
  }
  const fixedWidthsSum =
    2 * widths.landmark + (showZ ? widths.z : 0) + widths.residual + widths.delete;
  const pairColumnWidth = isWide
    ? pairWidth
    : Math.max(numberLabelWidth, tableWidth - fixedWidthsSum);
  const showFullLabel = pairColumnWidth >= fullLabelWidth;

  const landmarkColumns: ColumnsType<LandmarkPair> = SIDES.map((side) => ({
    title: (
      <Tooltip title={`${layerNames[side]} (${VIEW_NAMES[side]} view)`}>
        {isNarrow ? (side === "fixed" ? "L" : "R") : side === "fixed" ? "Left" : "Right"}
      </Tooltip>
    ),
    key: side,
    width: widths.landmark,
    align: isWide ? undefined : "center",
    ellipsis: isWide,
    render: (_value: unknown, pair: LandmarkPair) => {
      const landmark = pair.landmarks[side];
      if (landmark == null) {
        return <MissingLandmarkMarker side={side} />;
      }
      const coordinates = landmark.position.join(", ");
      return isWide ? (
        <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          <LandmarkColorDot color={landmark.color} />
          <Typography.Text type="secondary">{coordinates}</Typography.Text>
        </span>
      ) : (
        <Tooltip title={`Position: ${coordinates}`}>
          <LandmarkColorDot color={landmark.color} hasGap={false} />
        </Tooltip>
      );
    },
  }));

  return [
    {
      title: showFullLabel ? "Pair" : "#",
      key: "pair",
      width: pairColumnWidth,
      render: (_value, pair) =>
        pair.pairId == null ? (
          <Typography.Text type="secondary">–</Typography.Text>
        ) : showFullLabel ? (
          getLandmarkTreeName(pair.pairId)
        ) : (
          pair.pairId
        ),
    },
    ...landmarkColumns,
    ...(showZ
      ? [
          {
            title: "z",
            key: "z",
            width: widths.z,
            render: (_value: unknown, pair: LandmarkPair) => {
              const landmark = pair.landmarks.fixed ?? pair.landmarks.moving;
              return (
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}
                >
                  {landmark?.position[2]}
                </Typography.Text>
              );
            },
          },
        ]
      : []),
    {
      title: (
        <Tooltip title="How far apart the two landmarks of the pair still are after the transform">
          Error
        </Tooltip>
      ),
      key: "residual",
      width: widths.residual,
      render: (_value, pair) =>
        pair.residual != null ? (
          <ResidualCell
            residual={pair.residual}
            isHigh={isHighResidual(pair.residual, meanResidual, voxelSize.factor)}
            maxResidual={maxResidual}
            showBar={!isNarrow}
            voxelSize={voxelSize}
          />
        ) : (
          <Typography.Text type="secondary">–</Typography.Text>
        ),
    },
    {
      key: "delete",
      width: widths.delete,
      render: (_value, pair) => (
        // A click on a row selects the pair, but not a click on this button.
        <span onClick={(event) => event.stopPropagation()}>
          <Popconfirm
            title={
              isCompletePair(pair) && pair.pairId != null
                ? `Delete ${getLandmarkTreeName(pair.pairId)} in both views?`
                : "Delete this landmark?"
            }
            okText="Delete"
            onConfirm={() => onDeletePair(pair)}
          >
            <Button type="text" size="small" icon={<DeleteOutlined />} aria-label="Delete" />
          </Popconfirm>
        </span>
      ),
    },
  ];
}

// Offers to start the active moving layer with the fixed layer landmarks of another moving
// layer. The right view then asks for the partner of each of them.
function CopyLandmarksOffer({
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
    <Card
      size="small"
      title={
        <Typography.Text strong>
          <CopyOutlined /> Or reuse landmarks of another layer
        </Typography.Text>
      }
    >
      <Flex vertical gap={8}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Copies the {fixedLayerName} landmarks of that layer. The right view then asks for the
          partner of each one.
        </Typography.Text>
        <Space.Compact block>
          <Select
            value={selectedSource.layerName}
            onChange={setSourceLayerName}
            options={sources.map(({ layerName, landmarkCount }) => ({
              value: layerName,
              label: `${layerName} · ${landmarkCount} ${pluralize("landmark", landmarkCount)}`,
            }))}
            // Takes the width that the button leaves free.
            style={{ flex: 1, minWidth: 0 }}
          />
          <AsyncButton onClick={() => onCopy(selectedSource.layerName)}>Copy</AsyncButton>
        </Space.Compact>
      </Flex>
    </Card>
  );
}

function StepNumber({ children }: { children: React.ReactNode }) {
  const { token } = theme.useToken();
  return (
    <span
      style={{
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 20,
        borderRadius: "50%",
        border: `1px solid ${token.colorBorder}`,
        fontSize: 11,
        fontWeight: token.fontWeightStrong,
      }}
    >
      {children}
    </span>
  );
}

function EmptyLandmarkState({
  layerNames,
  copySources,
  onCopyLandmarks,
}: {
  layerNames: LayerNames;
  copySources: CopySource[];
  onCopyLandmarks: (sourceLayerName: string) => Promise<void>;
}) {
  const steps = [
    `Click a clear structure in the left view (${layerNames.fixed}).`,
    `Click the same structure in the right view (${layerNames.moving}).`,
    "Repeat. From 3 pairs on, the right view shows the transformed result. Spread the pairs out in x, y and z.",
  ];
  return (
    <Flex vertical gap={16}>
      <Flex vertical gap={10}>
        <Typography.Text strong>How to place landmarks</Typography.Text>
        {steps.map((step, index) => (
          <Flex key={step} gap={10} align="start">
            <StepNumber>{index + 1}</StepNumber>
            <Typography.Text>{step}</Typography.Text>
          </Flex>
        ))}
      </Flex>
      <CopyLandmarksOffer
        fixedLayerName={layerNames.fixed}
        sources={copySources}
        onCopy={onCopyLandmarks}
      />
    </Flex>
  );
}

/** The landmark pairs of the active moving layer: a table that fills the height that the
 * other parts of the panel leave free, or instructions while there are no pairs.
 */
export function LandmarkPairSection({
  pairs,
  layerNames,
  voxelSize,
  meanResidual,
  selectedPairKey,
  onSelectPair,
  onDeletePair,
  copySources,
  onCopyLandmarks,
}: {
  pairs: LandmarkPair[];
  layerNames: LayerNames;
  voxelSize: VoxelSize;
  meanResidual: number | null;
  selectedPairKey: string | null;
  onSelectPair: (pair: LandmarkPair) => void;
  onDeletePair: (pair: LandmarkPair) => void;
  // Moving layers whose fixed layer landmarks can be copied while there are no landmarks yet.
  copySources: CopySource[];
  onCopyLandmarks: (sourceLayerName: string) => Promise<void>;
}) {
  const { token } = theme.useToken();
  const [sortKey, setSortKey] = useState<SortKey>("pair");
  const [tableAreaRef, tableAreaSize] = useElementSize();
  const maxResidual = Math.max(0, ...pairs.map((pair) => pair.residual ?? 0));
  const maxPairId = Math.max(1, ...pairs.map((pair) => pair.pairId ?? 0));
  const columns = getPairColumns({
    tableWidth: tableAreaSize.width,
    layerNames,
    voxelSize,
    meanResidual,
    maxResidual,
    maxPairId,
    onDeletePair,
  });
  // Only at extreme widths, the minimum column widths make the table scroll sideways.
  const columnsWidth = columns.reduce((sum, column) => sum + Number(column.width ?? 0), 0);

  return (
    <Flex vertical style={{ flex: 1, minHeight: 0 }}>
      <Flex
        justify="space-between"
        align="center"
        gap={8}
        style={{ padding: `${token.paddingSM}px ${token.paddingSM}px ${token.paddingXS}px` }}
      >
        <Flex align="center" gap={8}>
          <Typography.Text strong>Landmark pairs</Typography.Text>
          <Badge
            count={pairs.length}
            showZero
            style={{ backgroundColor: token.colorFillSecondary, color: token.colorText }}
          />
        </Flex>
        {pairs.length > 0 ? (
          <Flex align="center" gap={6}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Sort
            </Typography.Text>
            <Segmented<SortKey>
              size="small"
              value={sortKey}
              onChange={setSortKey}
              options={[
                { value: "pair", label: "#" },
                { value: "error", label: "Error" },
              ]}
            />
          </Flex>
        ) : null}
      </Flex>
      <div
        ref={tableAreaRef}
        style={{
          flex: 1,
          minHeight: 0,
          // The instructions scroll if the panel is too low.
          overflowY: pairs.length === 0 ? "auto" : "hidden",
          padding: pairs.length === 0 ? `${token.paddingXS}px ${token.paddingSM}px` : undefined,
        }}
      >
        {pairs.length === 0 ? (
          <EmptyLandmarkState
            layerNames={layerNames}
            copySources={copySources}
            onCopyLandmarks={onCopyLandmarks}
          />
        ) : tableAreaSize.width > 0 ? (
          <Table<LandmarkPair>
            virtual
            size="small"
            pagination={false}
            columns={columns}
            dataSource={sortPairs(pairs, sortKey)}
            onRow={(pair) => ({
              onClick: () => onSelectPair(pair),
              style: { cursor: "pointer" },
              title: "Select this pair in both views",
            })}
            rowClassName={(pair) =>
              pair.key === selectedPairKey
                ? "is-selected-landmark-pair"
                : isCompletePair(pair)
                  ? ""
                  : "is-unpaired-landmark"
            }
            scroll={{
              x: Math.max(tableAreaSize.width, columnsWidth),
              y: Math.max(tableAreaSize.height - TABLE_HEADER_HEIGHT, 0),
            }}
          />
        ) : null}
      </div>
    </Flex>
  );
}
