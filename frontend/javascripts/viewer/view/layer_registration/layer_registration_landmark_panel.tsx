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
import { SidebarSection } from "dashboard/sidebar_section";
import { pluralize } from "libs/utils";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { VoxelSize } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { AnnotationIdentity } from "viewer/view/right_border_tabs/info_tab/identity_block";
import {
  type EstimatedTransform,
  formatResidual,
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
} from "./layer_registration_helpers";
import type { LandmarkExportFormat } from "./layer_registration_landmark_export";
import {
  CopyLandmarksOffer,
  type CopySource,
  LayerRegistrationMovingLayerList,
  type MovingLayerRow,
} from "./layer_registration_moving_layer_list";
import type { SaveState } from "./layer_registration_protocol";

// A pair whose error is this many times higher than the mean error is highlighted, because it
// was probably placed imprecisely. Errors below the size of one voxel are never highlighted:
// if the landmarks fit exactly, all errors are just floating point noise.
const HIGH_RESIDUAL_FACTOR = 2;

// The pair list is virtualized, which needs fixed column widths and a fixed body height. At
// the default panel width, the list scrolls sideways to the delete buttons.
const PAIR_COLUMN_WIDTHS = { name: 60, landmark: 136, residual: 84, delete: 40 };
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
  estimatedTransform: EstimatedTransform | null;
  // Why no transform could be estimated, if so.
  estimationErrorMessage: string | null;
  isOtherLayerVisible: Record<Side, boolean>;
  onToggleOtherLayer: (side: Side) => void;
  isTransformShown: Record<Side, boolean>;
  onToggleTransform: (side: Side) => void;
  // False if the layers can't be colored, see getOverlayLayerColors.
  canColorOverlay: boolean;
  isColorOverlayEnabled: boolean;
  onColorOverlayChange: (isEnabled: boolean) => void;
  canApplyTransformToDataset: boolean;
  onApplyTransformToDataset: () => void;
  // Whether the dataset uses the estimated transform for the moving layer.
  isAppliedToDataset: boolean;
  // One row per moving layer. The list is only shown if there is more than one.
  movingLayerRows: MovingLayerRow[];
  onSelectMovingLayer: (layerName: string) => void;
  // Moving layers whose fixed layer landmarks can be copied while there are no landmarks yet.
  copySources: CopySource[];
  onCopyLandmarks: (sourceLayerName: string) => Promise<void>;
  onSelectPair: (pair: LandmarkPair) => void;
  onDeletePair: (pair: LandmarkPair) => void;
  onDownloadLandmarks: (format: LandmarkExportFormat) => void;
  // The page that lists the layer registrations of the dataset.
  layerRegistrationListUrl: string;
  // Whether the layer registration annotation is saved, being saved or has unsaved changes.
  saveState: SaveState;
  onSave: () => Promise<void>;
};

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
  return pair.pairId != null && pair.landmarks.fixed != null && pair.landmarks.moving != null;
}

function TransformStatus({
  pairs,
  estimatedTransform,
  estimationErrorMessage,
  meanResidual,
  voxelSize,
}: {
  pairs: LandmarkPair[];
  estimatedTransform: EstimatedTransform | null;
  estimationErrorMessage: string | null;
  meanResidual: number | null;
  voxelSize: VoxelSize;
}) {
  const completePairCount = pairs.filter(isCompletePair).length;
  // Each incomplete row has one landmark.
  const unpairedLandmarkCount = pairs.length - completePairCount;
  return (
    <Flex vertical gap={4}>
      {estimatedTransform != null ? (
        <Typography.Text>
          Transform estimated · {completePairCount} pairs
          {meanResidual != null ? ` · mean error ${formatResidual(meanResidual, voxelSize)}` : null}
        </Typography.Text>
      ) : (
        <Typography.Text type="secondary">
          No transform yet · {completePairCount} of at least {MIN_LANDMARK_PAIR_COUNT} pairs
        </Typography.Text>
      )}
      {unpairedLandmarkCount > 0 ? (
        <Typography.Text type="warning">
          {unpairedLandmarkCount} {pluralize("landmark", unpairedLandmarkCount)} without a partner{" "}
          {unpairedLandmarkCount === 1 ? "is" : "are"} not used for the transform.
        </Typography.Text>
      ) : null}
      {estimatedTransform?.usedCopiesInNextSlice ? (
        <Typography.Text type="warning">
          The landmarks lie in one plane, so the transform assumes that the layers are only shifted
          against each other along z.
        </Typography.Text>
      ) : null}
      {/* With too few pairs, the line above already says why. */}
      {estimatedTransform == null &&
      estimationErrorMessage != null &&
      completePairCount >= MIN_LANDMARK_PAIR_COUNT ? (
        <Typography.Text type="warning">{estimationErrorMessage}</Typography.Text>
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

const SAVE_BUTTON_LABELS: Record<SaveState, string> = {
  saved: "Saved",
  saving: "Saving…",
  unsaved: "Save",
};

function AnnotationHeader({
  name,
  description,
  layerNames,
  layerRegistrationListUrl,
  saveState,
  onSave,
  onChangeName,
  onChangeDescription,
}: {
  name: string;
  description: string;
  layerNames: LayerNames;
  layerRegistrationListUrl: string;
  saveState: SaveState;
  onSave: () => Promise<void>;
  onChangeName: (name: string) => void;
  onChangeDescription: (description: string) => void;
}) {
  return (
    <>
      <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
        {/* Asks first if the landmarks aren't saved yet (see the blocker in
        layer_registration_workspace.tsx). */}
        <Link to={layerRegistrationListUrl}>
          <ArrowLeftOutlined /> Back to all layer registrations
        </Link>
        {/* Shows the automatic saves as well as the ones started with this button. */}
        <Tooltip title="The landmarks are saved automatically. Click to save right away.">
          <Button
            size="small"
            icon={<SaveOutlined />}
            loading={saveState === "saving"}
            disabled={saveState === "saved"}
            onClick={onSave}
          >
            {SAVE_BUTTON_LABELS[saveState]}
          </Button>
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
        Layer registration to {layerNames.fixed}
      </Tag>
    </>
  );
}

function LandmarkColorDot({ color }: { color: Vector3 }) {
  return <span className="landmark-color" style={{ background: rgbColorString(color) }} />;
}

// Shown instead of the position of a landmark that is not placed yet.
function MissingLandmarkMarker({ side }: { side: Side }) {
  return (
    <Tooltip title={`No landmark in the ${side === "fixed" ? "left" : "right"} view yet.`}>
      <Typography.Text type="warning">missing</Typography.Text>
    </Tooltip>
  );
}

function getPairColumns(
  layerNames: LayerNames,
  voxelSize: VoxelSize,
  meanResidual: number | null,
  onDeletePair: Props["onDeletePair"],
): ColumnsType<LandmarkPair> {
  // One column per view with the position of the landmark.
  const landmarkColumns = SIDES.map((side) => ({
    title: <Tooltip title={layerNames[side]}>{side === "fixed" ? "Left" : "Right"}</Tooltip>,
    key: side,
    width: PAIR_COLUMN_WIDTHS.landmark,
    ellipsis: true,
    render: (_value: unknown, pair: LandmarkPair) => {
      const landmark = pair.landmarks[side];
      return landmark != null ? (
        <Typography.Text style={{ fontSize: 12 }}>{landmark.position.join(", ")}</Typography.Text>
      ) : (
        <MissingLandmarkMarker side={side} />
      );
    },
  }));
  // Errors of the size of one voxel are not highlighted, see HIGH_RESIDUAL_FACTOR.
  const minHighResidual = Math.min(...voxelSize.factor);
  return [
    {
      // The pair id with the color that both landmarks of the pair have.
      title: <Tooltip title="Landmark pair number">#</Tooltip>,
      key: "name",
      width: PAIR_COLUMN_WIDTHS.name,
      render: (_value, pair) => {
        const color = (pair.landmarks.fixed ?? pair.landmarks.moving)?.color;
        return (
          <span style={{ whiteSpace: "nowrap" }}>
            {color != null ? <LandmarkColorDot color={color} /> : null}
            {pair.pairId ?? <Typography.Text type="secondary">–</Typography.Text>}
          </span>
        );
      },
    },
    {
      title: (
        <Tooltip title="How far apart the two landmarks of the pair still are after the transform">
          Error
        </Tooltip>
      ),
      key: "residual",
      width: PAIR_COLUMN_WIDTHS.residual,
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
    ...landmarkColumns,
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

export function LayerRegistrationLandmarkPanel({
  annotationName,
  annotationDescription,
  onChangeAnnotationName,
  onChangeAnnotationDescription,
  layerNames,
  voxelSize,
  landmarks,
  estimatedTransform,
  estimationErrorMessage,
  isOtherLayerVisible,
  onToggleOtherLayer,
  isTransformShown,
  onToggleTransform,
  canColorOverlay,
  isColorOverlayEnabled,
  onColorOverlayChange,
  canApplyTransformToDataset,
  onApplyTransformToDataset,
  isAppliedToDataset,
  movingLayerRows,
  onSelectMovingLayer,
  copySources,
  onCopyLandmarks,
  onSelectPair,
  onDeletePair,
  onDownloadLandmarks,
  layerRegistrationListUrl,
  saveState,
  onSave,
}: Props) {
  const pairs = getLandmarkPairs(
    landmarks,
    estimatedTransform?.movingToFixedTransform ?? null,
    voxelSize.factor,
  );
  const meanResidual = getMeanResidual(pairs);
  const [pairListRef, pairListHeight] = useElementHeight();
  const hasSeveralMovingLayers = movingLayerRows.length > 1;

  return (
    // The pair list fills the height that the other sections leave free.
    <Flex vertical style={{ height: "100%" }}>
      <AnnotationHeader
        name={annotationName}
        description={annotationDescription}
        layerNames={layerNames}
        layerRegistrationListUrl={layerRegistrationListUrl}
        saveState={saveState}
        onSave={onSave}
        onChangeName={onChangeAnnotationName}
        onChangeDescription={onChangeAnnotationDescription}
      />
      {hasSeveralMovingLayers ? (
        <LayerRegistrationMovingLayerList
          rows={movingLayerRows}
          activeLayerName={layerNames.moving}
          voxelSize={voxelSize}
          onSelect={onSelectMovingLayer}
        />
      ) : null}
      <SidebarSection
        label={hasSeveralMovingLayers ? `Transform of ${layerNames.moving}` : "Transform"}
      >
        <TransformStatus
          pairs={pairs}
          estimatedTransform={estimatedTransform}
          estimationErrorMessage={estimationErrorMessage}
          meanResidual={meanResidual}
          voxelSize={voxelSize}
        />
        <Flex gap={8} wrap style={{ marginTop: 8 }}>
          <Tooltip
            title={
              canApplyTransformToDataset
                ? hasSeveralMovingLayers
                  ? "Apply the transforms of all layers to the dataset, so that they are used everywhere"
                  : `Apply the transform to "${layerNames.moving}" in the dataset, so that it is used everywhere`
                : "You don't have the permission to edit this dataset."
            }
          >
            <Button
              type="primary"
              onClick={onApplyTransformToDataset}
              disabled={estimatedTransform == null || !canApplyTransformToDataset}
            >
              Apply to dataset…
            </Button>
          </Tooltip>
        </Flex>
        {estimatedTransform != null ? (
          isAppliedToDataset ? (
            <Typography.Text type="success" style={{ marginTop: 4 }}>
              <CheckOutlined /> The dataset uses this transform.
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary" style={{ marginTop: 4 }}>
              The dataset doesn't use this transform yet.
            </Typography.Text>
          )
        ) : null}
      </SidebarSection>
      <SidebarSection label="View">
        {SIDES.map((side) => (
          <Flex key={side} vertical style={{ alignSelf: "stretch", marginBottom: 8 }}>
            <Typography.Text strong>
              {side === "fixed" ? "Left" : "Right"} view ({layerNames[side]})
            </Typography.Text>
            <SwitchRow
              label={`Show ${layerNames[OTHER_SIDE[side]]} (X)`}
              checked={isOtherLayerVisible[side]}
              onChange={() => onToggleOtherLayer(side)}
            />
            <SwitchRow
              label={`Show ${layerNames[OTHER_SIDE[side]]} transformed (T)`}
              checked={isTransformShown[side]}
              disabled={estimatedTransform == null}
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
              structures look gray, and structures that don't match show green or magenta edges.
            </Typography.Text>
          </Flex>
        ) : null}
      </SidebarSection>
      <Flex justify="space-between" align="center">
        <div className="sidebar-label">
          {`${hasSeveralMovingLayers ? `Landmark pairs of ${layerNames.moving}` : "Landmark pairs"} (${pairs.length})`}
        </div>
        <LandmarkDownloadButton pairs={pairs} onDownload={onDownloadLandmarks} />
      </Flex>
      {/* Without pairs, the content decides the height, so that the empty state and the copy
      offer can't overflow into the elements below. */}
      <Flex
        vertical
        ref={pairListRef}
        style={pairs.length > 0 ? { flex: 1, minHeight: MIN_PAIR_LIST_HEIGHT } : undefined}
      >
        {pairs.length === 0 ? (
          <>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <ol style={{ textAlign: "left" }}>
                  <li>Click on a structure in the left view.</li>
                  <li>Click on the same structure in the right view.</li>
                  <li>
                    Repeat this for at least {MIN_LANDMARK_PAIR_COUNT} structures. The transform is
                    then estimated and shown automatically.
                  </li>
                </ol>
              }
            />
            <CopyLandmarksOffer
              fixedLayerName={layerNames.fixed}
              sources={copySources}
              onCopy={onCopyLandmarks}
            />
          </>
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
        transformed or untransformed · <Typography.Text keyboard>X</Typography.Text> show the other
        layer · <Typography.Text keyboard>Y</Typography.Text> move the other view here
      </Typography.Text>
    </Flex>
  );
}
