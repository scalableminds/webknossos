import { AimOutlined, EditOutlined, NodeIndexOutlined } from "@ant-design/icons";
import { Button, Empty, Flex, Switch, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { SidebarSection } from "dashboard/sidebar_section";
import Markdown from "libs/markdown_adapter";
import mean from "lodash-es/mean";
import { useEffect, useRef, useState } from "react";
import type { Vector3 } from "viewer/constants";
import type { Transform } from "viewer/model/helpers/transformation_helpers";
import { MarkdownModal } from "viewer/view/components/markdown_modal";
import { InlineIconButton } from "viewer/view/right_border_tabs/info_tab/info_tab_layout";
import {
  getLandmarkPairs,
  type Landmark,
  type LandmarkPair,
  type LayerNames,
  MIN_LANDMARK_PAIR_COUNT,
  OTHER_SIDE,
  SIDES,
  type Side,
} from "./alignment_helpers";

// A pair whose error is this many times higher than the mean error is highlighted, because it
// was probably placed imprecisely.
const HIGH_RESIDUAL_FACTOR = 2;

// The pair list is virtualized, which needs fixed column widths and a fixed body height.
const PAIR_COLUMN_WIDTHS = { index: 56, position: 150, residual: 72, focus: 40 };
const PAIR_TABLE_WIDTH =
  PAIR_COLUMN_WIDTHS.index +
  2 * PAIR_COLUMN_WIDTHS.position +
  PAIR_COLUMN_WIDTHS.residual +
  PAIR_COLUMN_WIDTHS.focus;
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
  landmarks: Record<Side, Landmark[]>;
  transformBtoA: Transform | null;
  // Whether the landmarks changed since the shown transform was computed.
  isAlignmentOutdated: boolean;
  // Whether the shown transform needed the fallback for landmarks in one plane.
  usedCopiesInNextSlice: boolean;
  isAutoAlignEnabled: boolean;
  onAutoAlignChange: (isEnabled: boolean) => void;
  isOtherLayerVisible: Record<Side, boolean>;
  canStoreAlignment: boolean;
  onAlign: () => void;
  onToggleOtherLayer: (side: Side) => void;
  onResetAlignment: () => void;
  onStoreAlignment: () => void;
  onFocusPair: (pair: LandmarkPair) => void;
};

function rgbColorString(color: Vector3): string {
  return `rgb(${color.map((component) => Math.round(component * 255)).join(",")})`;
}

function AlignmentStatus({
  layerNames,
  landmarks,
  pairs,
  transformBtoA,
  isAlignmentOutdated,
  usedCopiesInNextSlice,
}: {
  layerNames: LayerNames;
  landmarks: Record<Side, Landmark[]>;
  pairs: LandmarkPair[];
  transformBtoA: Transform | null;
  isAlignmentOutdated: boolean;
  usedCopiesInNextSlice: boolean;
}) {
  const completePairCount = Math.min(landmarks.A.length, landmarks.B.length);
  const residuals = pairs.flatMap((pair) => (pair.residual != null ? [pair.residual] : []));
  return (
    <Flex vertical gap={4}>
      {transformBtoA != null ? (
        <Typography.Text>
          Aligned · {completePairCount} pairs · mean error {mean(residuals).toFixed(1)}
        </Typography.Text>
      ) : (
        <Typography.Text type="secondary">
          Not aligned yet · {completePairCount} of at least {MIN_LANDMARK_PAIR_COUNT} pairs
        </Typography.Text>
      )}
      {landmarks.A.length !== landmarks.B.length ? (
        <Typography.Text type="warning">
          The views have a different number of landmarks ({landmarks.A.length} in {layerNames.A},{" "}
          {landmarks.B.length} in {layerNames.B}).
        </Typography.Text>
      ) : null}
      {transformBtoA != null && usedCopiesInNextSlice ? (
        <Typography.Text type="secondary">
          The landmarks lie in one plane, so the alignment assumes that the layers are only shifted
          against each other along z.
        </Typography.Text>
      ) : null}
      {isAlignmentOutdated ? (
        <Typography.Text type="warning">
          The landmarks changed since the last alignment. Align again to update it.
        </Typography.Text>
      ) : null}
    </Flex>
  );
}

function AnnotationHeader({
  name,
  description,
  layerNames,
  onChangeName,
  onChangeDescription,
}: {
  name: string;
  description: string;
  layerNames: LayerNames;
  onChangeName: (name: string) => void;
  onChangeDescription: (description: string) => void;
}) {
  const [isDescriptionModalOpen, setIsDescriptionModalOpen] = useState(false);
  return (
    <>
      <Typography.Title
        level={5}
        style={{ marginTop: 0, marginBottom: 12 }}
        editable={{
          // Start editing with the actual name, not the placeholder.
          text: name,
          tooltip: "Rename the alignment",
          // antd calls onChange whenever editing ends, even if nothing was changed.
          onChange: (newName) => newName !== name && onChangeName(newName),
        }}
      >
        {name !== "" ? name : "Unnamed alignment"}
      </Typography.Title>
      <Tag
        icon={<NodeIndexOutlined />}
        variant="outlined"
        // The panel is a vertical flex container, which would stretch the tag to its full width.
        style={{ marginBottom: 16, alignSelf: "flex-start" }}
      >
        {layerNames.B} → {layerNames.A}
      </Tag>
      <SidebarSection label="Description">
        <Flex align="start" gap={4}>
          {description !== "" ? (
            // Markdown renders its blocks without a wrapper, so they would become separate
            // items of the flex row.
            <div>
              <Markdown>{description}</Markdown>
            </div>
          ) : (
            <Typography.Text type="secondary">No description</Typography.Text>
          )}
          <InlineIconButton
            icon={<EditOutlined />}
            tooltip="Edit description"
            ariaLabel="Edit description"
            onClick={() => setIsDescriptionModalOpen(true)}
          />
        </Flex>
        <MarkdownModal
          label="Alignment Description"
          placeholder="[No description]"
          source={description}
          isOpen={isDescriptionModalOpen}
          onOk={() => setIsDescriptionModalOpen(false)}
          onChange={onChangeDescription}
        />
      </SidebarSection>
    </>
  );
}

function getPairColumns(
  layerNames: LayerNames,
  meanResidual: number,
  onFocusPair: Props["onFocusPair"],
): ColumnsType<LandmarkPair> {
  const positionColumns = SIDES.map((side) => ({
    title: layerNames[side],
    key: side,
    width: PAIR_COLUMN_WIDTHS.position,
    ellipsis: true,
    render: (_value: unknown, pair: LandmarkPair) => {
      const landmark = pair.landmarks[side];
      return landmark != null ? (
        landmark.position.join(", ")
      ) : (
        <Typography.Text type="warning">missing</Typography.Text>
      );
    },
  }));
  return [
    {
      title: "#",
      key: "index",
      width: PAIR_COLUMN_WIDTHS.index,
      render: (_value, pair, index) => {
        const color = (pair.landmarks.A ?? pair.landmarks.B)?.color;
        return (
          <span style={{ whiteSpace: "nowrap" }}>
            {color != null ? (
              <span className="landmark-color" style={{ background: rgbColorString(color) }} />
            ) : null}
            {index + 1}
          </span>
        );
      },
    },
    ...positionColumns,
    {
      title: <Tooltip title="How far apart the pair still is after the alignment">Error</Tooltip>,
      key: "residual",
      width: PAIR_COLUMN_WIDTHS.residual,
      align: "right",
      render: (_value, pair) => {
        if (pair.residual == null) {
          return null;
        }
        const isHigh = pair.residual > HIGH_RESIDUAL_FACTOR * meanResidual;
        return <Tag color={isHigh ? "warning" : undefined}>{pair.residual.toFixed(1)}</Tag>;
      },
    },
    {
      key: "focus",
      width: PAIR_COLUMN_WIDTHS.focus,
      render: (_value, pair) => (
        <Tooltip title="Move both views to this pair">
          <Button
            type="text"
            size="small"
            icon={<AimOutlined />}
            aria-label="Move both views to this pair"
            onClick={() => onFocusPair(pair)}
          />
        </Tooltip>
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
  landmarks,
  transformBtoA,
  isAlignmentOutdated,
  usedCopiesInNextSlice,
  isAutoAlignEnabled,
  onAutoAlignChange,
  isOtherLayerVisible,
  canStoreAlignment,
  onAlign,
  onToggleOtherLayer,
  onResetAlignment,
  onStoreAlignment,
  onFocusPair,
}: Props) {
  const pairs = getLandmarkPairs(landmarks, transformBtoA);
  const meanResidual = mean(
    pairs.flatMap((pair) => (pair.residual != null ? [pair.residual] : [])),
  );
  const [pairListRef, pairListHeight] = useElementHeight();

  return (
    // The pair list fills the height that the other sections leave free.
    <Flex vertical style={{ height: "100%" }}>
      <AnnotationHeader
        name={annotationName}
        description={annotationDescription}
        layerNames={layerNames}
        onChangeName={onChangeAnnotationName}
        onChangeDescription={onChangeAnnotationDescription}
      />
      <SidebarSection label="Alignment">
        <AlignmentStatus
          layerNames={layerNames}
          landmarks={landmarks}
          pairs={pairs}
          transformBtoA={transformBtoA}
          isAlignmentOutdated={isAlignmentOutdated}
          usedCopiesInNextSlice={usedCopiesInNextSlice}
        />
        <Flex gap={8} wrap style={{ marginTop: 8 }}>
          <Button onClick={onAlign}>Align (T)</Button>
          <Tooltip
            title={
              canStoreAlignment
                ? `Store the alignment as the default transform of "${layerNames.B}" in the dataset`
                : "You don't have the permission to edit this dataset."
            }
          >
            <Button
              type="primary"
              onClick={onStoreAlignment}
              disabled={transformBtoA == null || !canStoreAlignment}
            >
              Store as default…
            </Button>
          </Tooltip>
          <Tooltip title="Show both layers untransformed again">
            <Button type="link" onClick={onResetAlignment} disabled={transformBtoA == null}>
              Reset
            </Button>
          </Tooltip>
        </Flex>
        <Flex
          justify="space-between"
          align="center"
          gap={8}
          style={{ alignSelf: "stretch", marginTop: 8 }}
        >
          <Typography.Text>Align automatically after every change</Typography.Text>
          <Switch size="small" checked={isAutoAlignEnabled} onChange={onAutoAlignChange} />
        </Flex>
      </SidebarSection>
      <SidebarSection label="View">
        {SIDES.map((side) => (
          <Flex
            key={side}
            justify="space-between"
            align="center"
            gap={8}
            style={{ alignSelf: "stretch" }}
          >
            <Typography.Text>
              Show {layerNames[OTHER_SIDE[side]]} in the {side === "A" ? "left" : "right"} view
            </Typography.Text>
            <Switch
              size="small"
              checked={isOtherLayerVisible[side]}
              onChange={() => onToggleOtherLayer(side)}
            />
          </Flex>
        ))}
      </SidebarSection>
      <div className="sidebar-label">Landmark pairs ({pairs.length})</div>
      <Flex vertical ref={pairListRef} style={{ flex: 1, minHeight: MIN_PAIR_LIST_HEIGHT }}>
        {pairs.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <ol style={{ textAlign: "left" }}>
                <li>Click on a structure in the left view.</li>
                <li>Click on the same structure in the right view.</li>
                <li>
                  Repeat this for at least {MIN_LANDMARK_PAIR_COUNT} structures, then press{" "}
                  <Typography.Text keyboard>T</Typography.Text>.
                </li>
              </ol>
            }
          />
        ) : (
          <Table<LandmarkPair>
            virtual
            size="small"
            pagination={false}
            columns={getPairColumns(layerNames, meanResidual, onFocusPair)}
            dataSource={pairs}
            scroll={{
              x: PAIR_TABLE_WIDTH,
              y: Math.max(pairListHeight - PAIR_TABLE_HEADER_HEIGHT, MIN_PAIR_LIST_HEIGHT),
            }}
          />
        )}
      </Flex>
      <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
        In the focused view: <Typography.Text keyboard>T</Typography.Text> align ·{" "}
        <Typography.Text keyboard>X</Typography.Text> show the other layer ·{" "}
        <Typography.Text keyboard>Y</Typography.Text> move the other view here
      </Typography.Text>
    </Flex>
  );
}
