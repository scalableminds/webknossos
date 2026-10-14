import { DeleteOutlined } from "@ant-design/icons";
import {
  Badge,
  Button,
  Flex,
  Popconfirm,
  Segmented,
  Table,
  Tooltip,
  Typography,
  theme,
} from "antd";
import type { ColumnsType, ColumnType } from "antd/es/table";
import { useElementSize } from "libs/react_hooks";
import capitalize from "lodash-es/capitalize";
import { useState } from "react";
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
  VIEW_NAMES,
} from "../helpers/layer_registration_helpers";
import type { CopySource } from "../helpers/layer_registration_moving_layers";
import { EmptyLandmarkState } from "./layer_registration_empty_landmark_state";

type SortKey = "pair" | "error";

// The table header of antd's small table, needed to compute the height of the table body.
const TABLE_HEADER_HEIGHT = 39;
// From this table width on, the landmark columns show the coordinates next to the colors.
const WIDE_TABLE_MIN_WIDTH = 456;
// Below this table width, the z column and the error bars are left out.
const NARROW_TABLE_MAX_WIDTH = 300;
// Used to estimate the width that the pair column needs: the horizontal padding of a cell of
// antd's small table, and the width of a character in the table's font.
const CELL_PADDING = 16;
const LABEL_CHAR_WIDTH = 8;
const SMALL_NUMBER_STYLE = { fontSize: 12, fontVariantNumeric: "tabular-nums" } as const;

function getLabelWidth(label: string): number {
  return label.length * LABEL_CHAR_WIDTH + CELL_PADDING;
}

function getRgbColorString(color: Vector3): string {
  return `rgb(${color.map((component) => Math.round(component * 255)).join(",")})`;
}

// The color that both landmarks of a pair have in the views (see getLandmarkColor). The
// .landmark-color class adds a ring that keeps light and dark colors visible in both themes.
export function LandmarkColorDot({ color, hasGap = true }: { color: Vector3; hasGap?: boolean }) {
  return (
    <span
      className="landmark-color"
      style={{ background: getRgbColorString(color), marginRight: hasGap ? undefined : 0 }}
    />
  );
}

type ColumnLayout = {
  // Wide tables show the coordinates of the landmarks, narrow ones leave out the z column and
  // the error bars.
  isWide: boolean;
  isNarrow: boolean;
  showZ: boolean;
  // Whether the pair column shows "Landmark 12" or only the number. A cut-off name would hide
  // the number.
  showFullLabel: boolean;
  widths: Record<"pair" | "landmark" | "z" | "residual" | "delete", number>;
};

// The virtualized table needs fixed column widths. The landmark columns are wide enough for
// their titles in one line.
function getColumnLayout(tableWidth: number, maxPairId: number): ColumnLayout {
  const isWide = tableWidth >= WIDE_TABLE_MIN_WIDTH;
  const isNarrow = tableWidth < NARROW_TABLE_MAX_WIDTH;
  const showZ = !isWide && !isNarrow;
  const fullLabelWidth = getLabelWidth(getLandmarkTreeName(maxPairId));
  const widths = {
    z: 52,
    residual: isNarrow ? 64 : isWide ? 116 : 108,
    delete: isNarrow ? 32 : 36,
  };
  if (isWide) {
    const pairWidth = Math.max(fullLabelWidth, 96);
    const landmarkWidth = Math.max(
      120,
      Math.floor((tableWidth - pairWidth - widths.residual - widths.delete) / 2),
    );
    return {
      isWide,
      isNarrow,
      showZ,
      showFullLabel: true,
      widths: { ...widths, pair: pairWidth, landmark: landmarkWidth },
    };
  }
  // Without coordinates, the pair column takes the width that the other columns leave free.
  const landmarkWidth = isNarrow ? 36 : 52;
  const otherColumnsWidth =
    2 * landmarkWidth + (showZ ? widths.z : 0) + widths.residual + widths.delete;
  const pairWidth = Math.max(getLabelWidth(String(maxPairId)), 36, tableWidth - otherColumnsWidth);
  return {
    isWide,
    isNarrow,
    showZ,
    showFullLabel: pairWidth >= fullLabelWidth,
    widths: { ...widths, pair: pairWidth, landmark: landmarkWidth },
  };
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
          ...SMALL_NUMBER_STYLE,
          whiteSpace: "nowrap",
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

function getPairColumn({ widths, showFullLabel }: ColumnLayout): ColumnType<LandmarkPair> {
  return {
    title: showFullLabel ? "Pair" : "#",
    key: "pair",
    width: widths.pair,
    render: (_value, { pairId }) =>
      pairId == null ? (
        <Typography.Text type="secondary">–</Typography.Text>
      ) : showFullLabel ? (
        getLandmarkTreeName(pairId)
      ) : (
        pairId
      ),
  };
}

// Wide tables show the color and the coordinates of a landmark, other tables only the color.
function getLandmarkColumn(
  side: Side,
  { widths, isWide, isNarrow }: ColumnLayout,
  layerNames: LayerNames,
): ColumnType<LandmarkPair> {
  const viewName = capitalize(VIEW_NAMES[side]);
  return {
    title: (
      <Tooltip title={`${layerNames[side]} (${VIEW_NAMES[side]} view)`}>
        {isNarrow ? viewName[0] : viewName}
      </Tooltip>
    ),
    key: side,
    width: widths.landmark,
    align: isWide ? undefined : "center",
    ellipsis: isWide,
    render: (_value, pair) => {
      const landmark = pair.landmarks[side];
      if (landmark == null) {
        return <MissingLandmarkMarker side={side} />;
      }
      const coordinates = landmark.position.join(", ");
      return isWide ? (
        <span style={{ ...SMALL_NUMBER_STYLE, whiteSpace: "nowrap" }}>
          <LandmarkColorDot color={landmark.color} />
          <Typography.Text type="secondary">{coordinates}</Typography.Text>
        </span>
      ) : (
        <Tooltip title={`Position: ${coordinates}`}>
          <LandmarkColorDot color={landmark.color} hasGap={false} />
        </Tooltip>
      );
    },
  };
}

function getZColumn({ widths }: ColumnLayout): ColumnType<LandmarkPair> {
  return {
    title: "z",
    key: "z",
    width: widths.z,
    render: (_value, pair) => (
      <Typography.Text type="secondary" style={SMALL_NUMBER_STYLE}>
        {(pair.landmarks.fixed ?? pair.landmarks.moving)?.position[2]}
      </Typography.Text>
    ),
  };
}

function getResidualColumn(
  { widths, isNarrow }: ColumnLayout,
  voxelSize: VoxelSize,
  meanResidual: number | null,
  maxResidual: number,
): ColumnType<LandmarkPair> {
  return {
    title: (
      <Tooltip title="How far apart the two landmarks of the pair still are after the transform">
        Error
      </Tooltip>
    ),
    key: "residual",
    width: widths.residual,
    render: (_value, { residual }) =>
      residual != null ? (
        <ResidualCell
          residual={residual}
          isHigh={isHighResidual(residual, meanResidual, voxelSize.factor)}
          maxResidual={maxResidual}
          showBar={!isNarrow}
          voxelSize={voxelSize}
        />
      ) : (
        <Typography.Text type="secondary">–</Typography.Text>
      ),
  };
}

function getDeleteColumn(
  { widths }: ColumnLayout,
  onDeletePair: (pair: LandmarkPair) => void,
): ColumnType<LandmarkPair> {
  return {
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
  };
}

function getPairColumns({
  tableWidth,
  pairs,
  layerNames,
  voxelSize,
  meanResidual,
  onDeletePair,
}: {
  tableWidth: number;
  pairs: LandmarkPair[];
  layerNames: LayerNames;
  voxelSize: VoxelSize;
  meanResidual: number | null;
  onDeletePair: (pair: LandmarkPair) => void;
}): ColumnsType<LandmarkPair> {
  const maxResidual = Math.max(0, ...pairs.map((pair) => pair.residual ?? 0));
  const maxPairId = Math.max(1, ...pairs.map((pair) => pair.pairId ?? 0));
  const layout = getColumnLayout(tableWidth, maxPairId);
  return [
    getPairColumn(layout),
    ...SIDES.map((side) => getLandmarkColumn(side, layout, layerNames)),
    ...(layout.showZ ? [getZColumn(layout)] : []),
    getResidualColumn(layout, voxelSize, meanResidual, maxResidual),
    getDeleteColumn(layout, onDeletePair),
  ];
}

function PairSectionHeader({
  pairCount,
  sortKey,
  onSortKeyChange,
}: {
  pairCount: number;
  sortKey: SortKey;
  onSortKeyChange: (sortKey: SortKey) => void;
}) {
  const { token } = theme.useToken();
  return (
    <Flex
      justify="space-between"
      align="center"
      gap={8}
      style={{ padding: `${token.paddingSM}px ${token.paddingSM}px ${token.paddingXS}px` }}
    >
      <Flex align="center" gap={8}>
        <Typography.Text strong>Landmark pairs</Typography.Text>
        <Badge
          count={pairCount}
          showZero
          style={{ backgroundColor: token.colorFillSecondary, color: token.colorText }}
        />
      </Flex>
      {pairCount > 0 ? (
        <Flex align="center" gap={6}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Sort
          </Typography.Text>
          <Segmented<SortKey>
            size="small"
            value={sortKey}
            onChange={onSortKeyChange}
            options={[
              { value: "pair", label: "#" },
              { value: "error", label: "Error" },
            ]}
          />
        </Flex>
      ) : null}
    </Flex>
  );
}

function getRowClassName(pair: LandmarkPair, selectedPairKey: string | null): string {
  if (pair.key === selectedPairKey) {
    return "is-selected-landmark-pair";
  }
  return isCompletePair(pair) ? "" : "is-unpaired-landmark";
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
  const columns = getPairColumns({
    tableWidth: tableAreaSize.width,
    pairs,
    layerNames,
    voxelSize,
    meanResidual,
    onDeletePair,
  });
  // Only at extreme widths, the minimum column widths make the table scroll sideways.
  const columnsWidth = columns.reduce((sum, column) => sum + Number(column.width ?? 0), 0);
  const hasPairs = pairs.length > 0;

  return (
    <Flex vertical style={{ flex: 1, minHeight: 0 }}>
      <PairSectionHeader pairCount={pairs.length} sortKey={sortKey} onSortKeyChange={setSortKey} />
      <div
        ref={tableAreaRef}
        style={{
          flex: 1,
          minHeight: 0,
          // The instructions scroll if the panel is too low.
          overflowY: hasPairs ? "hidden" : "auto",
          padding: hasPairs ? undefined : `${token.paddingXS}px ${token.paddingSM}px`,
        }}
      >
        {!hasPairs ? (
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
            rowClassName={(pair) => getRowClassName(pair, selectedPairKey)}
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
