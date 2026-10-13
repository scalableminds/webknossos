import {
  ArrowLeftOutlined,
  CheckOutlined,
  DeleteOutlined,
  DownloadOutlined,
  NodeIndexOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import {
  Button,
  Dropdown,
  Empty,
  Flex,
  type MenuProps,
  Popconfirm,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { AsyncButton } from "components/async_clickables";
import { SidebarSection } from "dashboard/sidebar_section";
import { formatNumberToLength } from "libs/format_utils";
import { pluralize } from "libs/utils";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { VoxelSize } from "types/api_types";
import { LongUnitToShortUnitMap, type Vector3 } from "viewer/constants";
import { AnnotationIdentity } from "viewer/view/right_border_tabs/info_tab/identity_block";
import {
  type Alignment,
  getLandmarkPairs,
  getLandmarkTreeName,
  getMeanResidual,
  type Landmark,
  type LandmarkPair,
  type LayerNames,
  MIN_LANDMARK_PAIR_COUNT,
  OTHER_SIDE,
  SIDES,
  type Side,
} from "./alignment_helpers";
import type { LandmarkExportFormat } from "./landmark_export";

// A pair whose error is this many times higher than the mean error is highlighted, because it
// was probably placed imprecisely. Errors below the size of one voxel are never highlighted:
// if the landmarks fit exactly, all errors are just floating point noise.
const HIGH_RESIDUAL_FACTOR = 2;

// The pair list is virtualized, which needs fixed column widths and a fixed body height. The
// widths fit into the default panel width, so the list doesn't scroll sideways.
const PAIR_COLUMN_WIDTHS = { name: 104, landmark: 56, residual: 84, delete: 40 };
const PAIR_TABLE_WIDTH =
  PAIR_COLUMN_WIDTHS.name +
  2 * PAIR_COLUMN_WIDTHS.landmark +
  PAIR_COLUMN_WIDTHS.residual +
  PAIR_COLUMN_WIDTHS.delete;
const PAIR_TABLE_HEADER_HEIGHT = 40;
const MIN_PAIR_LIST_HEIGHT = 200;

// The current height of the element that the returned ref is attached to.
function useElementHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (element == null) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, height] as const;
}

type Props = {
  annotationName: string;
  annotationDescription: string;
  onChangeAnnotationName: (name: string) => void;
  onChangeAnnotationDescription: (description: string) => void;
  layerNames: LayerNames;
  // The voxel size of the dataset, to show the errors of the pairs as lengths.
  voxelSize: VoxelSize;
  landmarks: Record<Side, Landmark[]>;
  alignment: Alignment | null;
  // Why no alignment could be estimated, if so.
  alignmentErrorMessage: string | null;
  isOtherLayerVisible: Record<Side, boolean>;
  onToggleOtherLayer: (side: Side) => void;
  isTransformShown: Record<Side, boolean>;
  onToggleTransform: (side: Side) => void;
  // False if the layers can't be colored, see getOverlayLayerColors.
  canColorOverlay: boolean;
  isColorOverlayEnabled: boolean;
  onColorOverlayChange: (isEnabled: boolean) => void;
  canApplyAlignmentToDataset: boolean;
  onApplyAlignmentToDataset: () => void;
  // Whether the moving layer has the current alignment as its transform in the dataset.
  isAppliedToDataset: boolean;
  onSelectPair: (pair: LandmarkPair) => void;
  onDeletePair: (pair: LandmarkPair) => void;
  onDownloadLandmarks: (format: LandmarkExportFormat) => void;
  // The page that lists the alignments of the dataset.
  alignmentListUrl: string;
  // Whether the alignment annotation has changes that are not saved yet.
  hasUnsavedChanges: boolean;
  onSave: () => Promise<void>;
};

// The residuals are lengths in the unit of the dataset (see getLandmarkPairs). Large values
// are shown in a larger unit, e.g. µm instead of nm.
function formatResidual(residual: number, voxelSize: VoxelSize): string {
  return formatNumberToLength(residual, LongUnitToShortUnitMap[voxelSize.unit]);
}

export function rgbColorString(color: Vector3): string {
  return `rgb(${color.map((component) => Math.round(component * 255)).join(",")})`;
}

function SwitchRow({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Flex justify="space-between" align="center" gap={8}>
      <Typography.Text type={disabled ? "secondary" : undefined}>{label}</Typography.Text>
      <Switch size="small" checked={checked} disabled={disabled} onChange={onChange} />
    </Flex>
  );
}

function isCompletePair(pair: LandmarkPair): boolean {
  return pair.pairId != null && pair.landmarks.A != null && pair.landmarks.B != null;
}

function AlignmentStatus({
  pairs,
  alignment,
  alignmentErrorMessage,
  meanResidual,
  voxelSize,
}: {
  pairs: LandmarkPair[];
  alignment: Alignment | null;
  alignmentErrorMessage: string | null;
  meanResidual: number | null;
  voxelSize: VoxelSize;
}) {
  const completePairCount = pairs.filter(isCompletePair).length;
  // Each incomplete row has one landmark.
  const unpairedLandmarkCount = pairs.length - completePairCount;
  return (
    <Flex vertical gap={4}>
      {alignment != null ? (
        <Typography.Text>
          Aligned · {completePairCount} pairs
          {meanResidual != null ? ` · mean error ${formatResidual(meanResidual, voxelSize)}` : null}
        </Typography.Text>
      ) : (
        <Typography.Text type="secondary">
          Not aligned yet · {completePairCount} of at least {MIN_LANDMARK_PAIR_COUNT} pairs
        </Typography.Text>
      )}
      {unpairedLandmarkCount > 0 ? (
        <Typography.Text type="warning">
          {unpairedLandmarkCount} {pluralize("landmark", unpairedLandmarkCount)} without a partner{" "}
          {unpairedLandmarkCount === 1 ? "is" : "are"} not used for the alignment.
        </Typography.Text>
      ) : null}
      {alignment?.usedCopiesInNextSlice ? (
        <Typography.Text type="warning">
          The landmarks lie in one plane, so the alignment assumes that the layers are only shifted
          against each other along z.
        </Typography.Text>
      ) : null}
      {/* With too few pairs, the line above already says why. */}
      {alignment == null &&
      alignmentErrorMessage != null &&
      completePairCount >= MIN_LANDMARK_PAIR_COUNT ? (
        <Typography.Text type="warning">{alignmentErrorMessage}</Typography.Text>
      ) : null}
    </Flex>
  );
}

const DOWNLOAD_MENU_ITEMS: MenuProps["items"] = [
  { key: "csv" satisfies LandmarkExportFormat, label: "BigWarp CSV" },
  { key: "nml" satisfies LandmarkExportFormat, label: "NML files (one per layer)" },
];

// Both formats can be uploaded in the dataset composition wizard. Only complete pairs are
// downloaded.
function LandmarkDownloadButton({
  pairs,
  onDownload,
}: {
  pairs: LandmarkPair[];
  onDownload: (format: LandmarkExportFormat) => void;
}) {
  const disabledReason = pairs.some(isCompletePair) ? null : "Place landmark pairs first.";
  return (
    <Tooltip title={disabledReason ?? "Download the landmark pairs for the dataset composition"}>
      <Dropdown
        disabled={disabledReason != null}
        trigger={["click"]}
        menu={{
          items: DOWNLOAD_MENU_ITEMS,
          onClick: ({ key }) => onDownload(key as LandmarkExportFormat),
        }}
      >
        <Button size="small" type="text" icon={<DownloadOutlined />}>
          Download
        </Button>
      </Dropdown>
    </Tooltip>
  );
}

function AnnotationHeader({
  name,
  description,
  layerNames,
  alignmentListUrl,
  hasUnsavedChanges,
  onSave,
  onChangeName,
  onChangeDescription,
}: {
  name: string;
  description: string;
  layerNames: LayerNames;
  alignmentListUrl: string;
  hasUnsavedChanges: boolean;
  onSave: () => Promise<void>;
  onChangeName: (name: string) => void;
  onChangeDescription: (description: string) => void;
}) {
  return (
    <>
      <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
        {/* Asks first if the landmarks aren't saved yet (see the blocker in alignment_workspace.tsx). */}
        <Link to={alignmentListUrl}>
          <ArrowLeftOutlined /> Back to all alignments
        </Link>
        <Tooltip title="The landmarks are saved automatically. Click to save right away.">
          <AsyncButton
            size="small"
            icon={<SaveOutlined />}
            disabled={!hasUnsavedChanges}
            onClick={onSave}
          >
            {hasUnsavedChanges ? "Save" : "Saved"}
          </AsyncButton>
        </Tooltip>
      </Flex>
      <AnnotationIdentity
        name={name}
        description={description}
        onChangeName={onChangeName}
        onChangeDescription={onChangeDescription}
      />
      <Tag
        icon={<NodeIndexOutlined />}
        variant="outlined"
        // The panel is a vertical flex container, which would stretch the tag to its full width.
        style={{ marginBottom: 16, alignSelf: "flex-start" }}
      >
        {layerNames.B} → {layerNames.A}
      </Tag>
    </>
  );
}

function getPairColumns(
  layerNames: LayerNames,
  voxelSize: VoxelSize,
  meanResidual: number | null,
  onDeletePair: Props["onDeletePair"],
): ColumnsType<LandmarkPair> {
  // One column per view with the color of the landmark, to find it in the view. The position
  // is shown on hover.
  const landmarkColumns = SIDES.map((side) => ({
    title: <Tooltip title={layerNames[side]}>{side === "A" ? "Left" : "Right"}</Tooltip>,
    key: side,
    width: PAIR_COLUMN_WIDTHS.landmark,
    align: "center" as const,
    render: (_value: unknown, pair: LandmarkPair) => {
      const landmark = pair.landmarks[side];
      return landmark != null ? (
        <Tooltip title={`Position: ${landmark.position.join(", ")}`}>
          <span className="landmark-color" style={{ background: rgbColorString(landmark.color) }} />
        </Tooltip>
      ) : (
        <Typography.Text type="warning">missing</Typography.Text>
      );
    },
  }));
  // Errors of the size of one voxel are not highlighted, see HIGH_RESIDUAL_FACTOR.
  const minHighResidual = Math.min(...voxelSize.factor);
  return [
    {
      title: "Name",
      key: "name",
      width: PAIR_COLUMN_WIDTHS.name,
      render: (_value, pair) =>
        pair.pairId != null ? (
          getLandmarkTreeName(pair.pairId)
        ) : (
          <Typography.Text type="secondary">Unnamed</Typography.Text>
        ),
    },
    ...landmarkColumns,
    {
      title: <Tooltip title="How far apart the pair still is after the alignment">Error</Tooltip>,
      key: "residual",
      width: PAIR_COLUMN_WIDTHS.residual,
      align: "right",
      render: (_value, pair) => {
        if (pair.residual == null) {
          return null;
        }
        const isHigh =
          meanResidual != null &&
          pair.residual > Math.max(HIGH_RESIDUAL_FACTOR * meanResidual, minHighResidual);
        return (
          <Tag color={isHigh ? "warning" : undefined} style={{ marginInlineEnd: 0 }}>
            {formatResidual(pair.residual, voxelSize)}
          </Tag>
        );
      },
    },
    {
      key: "delete",
      width: PAIR_COLUMN_WIDTHS.delete,
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

export function LandmarkPanel({
  annotationName,
  annotationDescription,
  onChangeAnnotationName,
  onChangeAnnotationDescription,
  layerNames,
  voxelSize,
  landmarks,
  alignment,
  alignmentErrorMessage,
  isOtherLayerVisible,
  onToggleOtherLayer,
  isTransformShown,
  onToggleTransform,
  canColorOverlay,
  isColorOverlayEnabled,
  onColorOverlayChange,
  canApplyAlignmentToDataset,
  onApplyAlignmentToDataset,
  isAppliedToDataset,
  onSelectPair,
  onDeletePair,
  onDownloadLandmarks,
  alignmentListUrl,
  hasUnsavedChanges,
  onSave,
}: Props) {
  const pairs = getLandmarkPairs(landmarks, alignment?.transformBtoA ?? null, voxelSize.factor);
  const meanResidual = getMeanResidual(pairs);
  const [pairListRef, pairListHeight] = useElementHeight();

  return (
    // The pair list fills the height that the other sections leave free.
    <Flex vertical style={{ height: "100%" }}>
      <AnnotationHeader
        name={annotationName}
        description={annotationDescription}
        layerNames={layerNames}
        alignmentListUrl={alignmentListUrl}
        hasUnsavedChanges={hasUnsavedChanges}
        onSave={onSave}
        onChangeName={onChangeAnnotationName}
        onChangeDescription={onChangeAnnotationDescription}
      />
      <SidebarSection label="Alignment">
        <AlignmentStatus
          pairs={pairs}
          alignment={alignment}
          alignmentErrorMessage={alignmentErrorMessage}
          meanResidual={meanResidual}
          voxelSize={voxelSize}
        />
        <Flex gap={8} wrap style={{ marginTop: 8 }}>
          <Tooltip
            title={
              canApplyAlignmentToDataset
                ? `Apply the alignment to "${layerNames.B}" in the dataset, so that it is used everywhere`
                : "You don't have the permission to edit this dataset."
            }
          >
            <Button
              type="primary"
              onClick={onApplyAlignmentToDataset}
              disabled={alignment == null || !canApplyAlignmentToDataset}
            >
              Apply to dataset…
            </Button>
          </Tooltip>
        </Flex>
        {alignment != null ? (
          isAppliedToDataset ? (
            <Typography.Text type="success" style={{ marginTop: 4 }}>
              <CheckOutlined /> The dataset uses this alignment.
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary" style={{ marginTop: 4 }}>
              The dataset doesn't use this alignment yet.
            </Typography.Text>
          )
        ) : null}
      </SidebarSection>
      <SidebarSection label="View">
        {SIDES.map((side) => (
          <Flex key={side} vertical style={{ alignSelf: "stretch", marginBottom: 8 }}>
            <Typography.Text strong>
              {side === "A" ? "Left" : "Right"} view ({layerNames[side]})
            </Typography.Text>
            <SwitchRow
              label={`Show ${layerNames[OTHER_SIDE[side]]} (X)`}
              checked={isOtherLayerVisible[side]}
              onChange={() => onToggleOtherLayer(side)}
            />
            <SwitchRow
              label={`Show ${layerNames[OTHER_SIDE[side]]} aligned (T)`}
              checked={isTransformShown[side]}
              disabled={alignment == null}
              onChange={() => onToggleTransform(side)}
            />
          </Flex>
        ))}
        {canColorOverlay ? (
          <Flex vertical style={{ alignSelf: "stretch" }}>
            <SwitchRow
              label="Color the layers green and magenta"
              checked={isColorOverlayEnabled}
              onChange={onColorOverlayChange}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Recommended for grayscale layers. In a view that shows both layers, matching
              structures look gray, and misaligned ones show green or magenta edges.
            </Typography.Text>
          </Flex>
        ) : null}
      </SidebarSection>
      <Flex justify="space-between" align="center">
        <div className="sidebar-label">Landmark pairs ({pairs.length})</div>
        <LandmarkDownloadButton pairs={pairs} onDownload={onDownloadLandmarks} />
      </Flex>
      <Flex vertical ref={pairListRef} style={{ flex: 1, minHeight: MIN_PAIR_LIST_HEIGHT }}>
        {pairs.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <ol style={{ textAlign: "left" }}>
                <li>Click on a structure in the left view.</li>
                <li>Click on the same structure in the right view.</li>
                <li>
                  Repeat this for at least {MIN_LANDMARK_PAIR_COUNT} structures. The layers are then
                  aligned automatically.
                </li>
              </ol>
            }
          />
        ) : (
          <Table<LandmarkPair>
            virtual
            size="small"
            pagination={false}
            columns={getPairColumns(layerNames, voxelSize, meanResidual, onDeletePair)}
            dataSource={pairs}
            onRow={(pair) => ({
              onClick: () => onSelectPair(pair),
              style: { cursor: "pointer" },
              title: "Select this pair in both views",
            })}
            rowClassName={(pair) => (isCompletePair(pair) ? "" : "is-unpaired-landmark")}
            scroll={{
              x: PAIR_TABLE_WIDTH,
              y: Math.max(pairListHeight, MIN_PAIR_LIST_HEIGHT) - PAIR_TABLE_HEADER_HEIGHT,
            }}
          />
        )}
      </Flex>
      <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
        In the view under the mouse: <Typography.Text keyboard>T</Typography.Text> other layer
        aligned or untransformed · <Typography.Text keyboard>X</Typography.Text> show the other
        layer · <Typography.Text keyboard>Y</Typography.Text> move the other view here
      </Typography.Text>
    </Flex>
  );
}
