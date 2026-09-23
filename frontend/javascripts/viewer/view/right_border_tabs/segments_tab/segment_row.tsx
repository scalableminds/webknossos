import Icon, { EllipsisOutlined, LoadingOutlined } from "@ant-design/icons";
import CrosshairsIcon from "@images/icons/icon-crosshairs.svg?react";
import MeshIcon from "@images/icons/icon-mesh-organic-boundary.svg?react";
import { type ButtonProps, Dropdown, Flex, type MenuProps } from "antd";
import classnames from "classnames";
import FastTooltip from "components/fast_tooltip";
import { V4 } from "libs/mjs";
import { useWkSelector } from "libs/react_hooks";
import { memo } from "react";
import { useDispatch } from "react-redux";
import type { Vector4 } from "viewer/constants";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import {
  getActiveSegmentationTracing,
  getMeshesForCurrentAdditionalCoordinates,
  getSegmentColorAsRGBA,
  getSegmentName,
  getSelectedIds,
} from "viewer/model/accessors/volumetracing_accessor";
import { updateTemporarySettingAction } from "viewer/model/actions/settings_actions";
import { rgbaToCSS } from "viewer/shaders/utils.glsl";
import type { MeshInformation, Segment } from "viewer/store";
import ButtonComponent from "viewer/view/components/button_component";
import type { SegmentUiNode } from "./hierarchy";
import { InlineEditableName } from "./inline_editable_name";
import { mayEditVisibleSegmentation } from "./segments_view_helper";

// Every row of the list is this tall, except the expanded one. Kept in sync with
// @segment-row-height in _right_menu.less, which needs it for antd's own row element.
export const SEGMENT_ROW_HEIGHT = 30;
const EXPANDED_ROW_PADDING = 7;
// The line box of the expanded row's name. Deliberately the height of the mesh chip, so
// that the chip lines up with the first line of the name without an offset, and the other
// fixed-size parts of the row only need to be centered on a known 20px line.
const EXPANDED_LINE_HEIGHT = 20;
const MESH_CHIP_SIZE = 20;
const ACTION_BUTTON_SIZE = 24;
const COLOR_DOT_SIZE = 9;

// Everything that keeps its size while the name wraps is centered on the first line.
const centerOnFirstLine = (size: number) => (EXPANDED_LINE_HEIGHT - size) / 2;

// Hides an element until its row is hovered or keyboard-focused (see _right_menu.less).
const HOVER_ONLY_CLASS = "segment-row__on-hover";

const MESH_CHIP_STYLE: React.CSSProperties = {
  width: MESH_CHIP_SIZE,
  height: MESH_CHIP_SIZE,
  minWidth: MESH_CHIP_SIZE,
  padding: 0,
  borderRadius: 5,
};

const ACTION_BUTTON_STYLE: React.CSSProperties = {
  width: ACTION_BUTTON_SIZE,
  height: ACTION_BUTTON_SIZE,
  minWidth: ACTION_BUTTON_SIZE,
  padding: 0,
  borderRadius: 5,
};

/*
 * Everything a segment row can do to its segment. Bundled into one object (built once
 * in SegmentTreeView) instead of a handful of callback props, so that the memoized rows
 * are not invalidated whenever the tree view re-renders.
 */
export type SegmentRowActions = {
  // Selects the segment and moves the camera to it (the name's click target).
  selectAndJumpTo: (segment: Segment) => void;
  // Moves the camera to the segment without touching the selection.
  centerInViewports: (segment: Segment) => void;
  computeAdHocMesh: (segment: Segment) => void;
  // The ways a mesh can be loaded for a segment, or null when ad-hoc computation is the
  // only one - then the mesh button triggers that directly instead of offering a choice.
  getMeshLoadMenuItems: (segment: Segment) => MenuProps["items"] | null;
  setMeshVisibility: (segment: Segment, isVisible: boolean) => void;
  // Removing a mesh that is still loading aborts the computation.
  cancelMeshComputation: (segment: Segment) => void;
  renameSegment: (segment: Segment, name: string) => void;
  // Renaming is owned by the tree view (keyed by node key), so that only one row at a
  // time is editable and drag & drop can be suspended while it is.
  startRenaming: (nodeKey: string) => void;
  finishRenaming: () => void;
};

type Props = {
  node: SegmentUiNode;
  // Whether this segment is the one at the center of the data viewports. Reported by the
  // crosshair button; looked up once for the whole list, hence a prop rather than a selector.
  isCentered: boolean;
  isRenaming: boolean;
  actions: SegmentRowActions;
  onContextMenu: (node: SegmentUiNode, event: React.MouseEvent<HTMLElement>) => void;
};

type MeshChipState = "computing" | "visible" | "hidden";

function getMeshChipState(mesh: MeshInformation): MeshChipState {
  if (mesh.isLoading) {
    return "computing";
  }
  return mesh.isVisible ? "visible" : "hidden";
}

type ButtonAppearance = Pick<ButtonProps, "color" | "variant" | "type">;

// A button that is only an affordance until its state turns on, at which point it also
// reports that state. Shared by the mesh chip and the "centered in viewports" button.
const IDLE_APPEARANCE: ButtonAppearance = { color: "default", type: "text" };
const ACTIVE_APPEARANCE: ButtonAppearance = { color: "primary", variant: "filled" };

// antd's color/variant pairs carry the whole appearance of the chip, so none of its three
// states needs a color of its own.
const MESH_CHIP_APPEARANCE: Record<MeshChipState, ButtonAppearance> = {
  visible: ACTIVE_APPEARANCE,
  hidden: { color: "default", variant: "outlined" },
  computing: { color: "gold", variant: "filled" },
};

function getMeshChipTooltip(mesh: MeshInformation): string {
  const kind = mesh.isPrecomputed ? "precomputed" : "ad-hoc";
  switch (getMeshChipState(mesh)) {
    case "computing":
      return "Computing mesh… Click to cancel.";
    case "visible":
      return `Mesh visible · ${kind}. Click to hide it.`;
    case "hidden":
      return `Mesh loaded · hidden · ${kind}. Click to show it.`;
  }
}

/*
 * The single mesh control of a row, in a slot that is always reserved so that loading or
 * removing a mesh never changes the row count or the row height of the list.
 *
 * Once a mesh exists the control is a chip that reflects its state and toggles it; until
 * then the same spot offers computing one, on hover. Both are the same size, so there is
 * never a separate "load mesh" button competing with a "mesh is loaded" chip.
 */
function MeshControl({
  segment,
  mesh,
  actions,
}: {
  segment: Segment;
  mesh: MeshInformation | undefined;
  actions: SegmentRowActions;
}) {
  if (mesh == null) {
    const meshLoadMenuItems = actions.getMeshLoadMenuItems(segment);
    if (meshLoadMenuItems != null) {
      // Both a precomputed mesh file and ad-hoc computation are available. Which one is
      // wanted depends on whether the segment was edited since the file was computed, so
      // the button asks instead of guessing. The menu labels the options, so the button
      // carries no tooltip of its own.
      return (
        <Dropdown menu={{ items: meshLoadMenuItems }} trigger={["click"]}>
          <ButtonComponent
            className={HOVER_ONLY_CLASS}
            {...IDLE_APPEARANCE}
            size="small"
            style={MESH_CHIP_STYLE}
            icon={<Icon component={MeshIcon} />}
            // Opening the menu is not a selection change.
            onClick={(event) => event.stopPropagation()}
          />
        </Dropdown>
      );
    }
    return (
      <FastTooltip title="Compute mesh (ad-hoc)" asChild>
        <ButtonComponent
          className={HOVER_ONLY_CLASS}
          {...IDLE_APPEARANCE}
          size="small"
          style={MESH_CHIP_STYLE}
          icon={<Icon component={MeshIcon} />}
          onClick={(event) => {
            event.stopPropagation();
            actions.computeAdHocMesh(segment);
          }}
        />
      </FastTooltip>
    );
  }
  const state = getMeshChipState(mesh);

  return (
    <FastTooltip title={getMeshChipTooltip(mesh)} asChild>
      <ButtonComponent
        {...MESH_CHIP_APPEARANCE[state]}
        size="small"
        style={MESH_CHIP_STYLE}
        icon={state === "computing" ? <LoadingOutlined /> : <Icon component={MeshIcon} />}
        onClick={(event) => {
          // The chip is a control of its own; clicking it must not also select the row.
          event.stopPropagation();
          if (state === "computing") {
            actions.cancelMeshComputation(segment);
          } else {
            actions.setMeshVisibility(segment, !mesh.isVisible);
          }
        }}
      />
    </FastTooltip>
  );
}

/*
 * The right-aligned icon buttons that appear while the row is hovered or keyboard-focused
 * (see the visibility rules in _right_menu.less). They replace the formerly always-visible
 * ellipsis button; the "more actions" button opens the very same menu as a right-click.
 * Anything mesh-related lives in the mesh slot instead, see MeshControl.
 */
function SegmentRowActionBar({
  node,
  actions,
  isCentered,
  isExpanded,
  onContextMenu,
}: {
  node: SegmentUiNode;
  actions: SegmentRowActions;
  isCentered: boolean;
  isExpanded: boolean;
  onContextMenu: Props["onContextMenu"];
}) {
  const { segment } = node;

  return (
    <Flex
      className="segment-row__actions"
      align="center"
      gap={1}
      style={{
        flex: "none",
        // Pulls the last button's box out into the row's right padding, so that its icon
        // lines up with the right edge of the mesh chip above and below it.
        marginRight: -4,
        marginTop: isExpanded ? centerOnFirstLine(ACTION_BUTTON_SIZE) : undefined,
      }}
    >
      {/*
        Doubles as the indicator for the segment at the center of the data viewports: it
        stays visible and takes the same highlight as a visible mesh chip, rather than
        hiding with the rest of the bar.
      */}
      <FastTooltip
        title={
          isCentered ? "This segment is centered in the data viewports" : "Center in viewports"
        }
        asChild
      >
        <ButtonComponent
          className={isCentered ? undefined : HOVER_ONLY_CLASS}
          {...(isCentered ? ACTIVE_APPEARANCE : IDLE_APPEARANCE)}
          size="small"
          style={ACTION_BUTTON_STYLE}
          icon={<Icon component={CrosshairsIcon} />}
          onClick={(event) => {
            event.stopPropagation();
            actions.centerInViewports(segment);
          }}
        />
      </FastTooltip>
      <FastTooltip title="More actions (also available via right-click)" asChild>
        <ButtonComponent
          className={HOVER_ONLY_CLASS}
          {...IDLE_APPEARANCE}
          size="small"
          style={ACTION_BUTTON_STYLE}
          icon={<EllipsisOutlined />}
          onClick={(event) => {
            // Opening the menu is not a selection change.
            event.stopPropagation();
            onContextMenu(node, event);
          }}
        />
      </FastTooltip>
    </Flex>
  );
}

/*
 * The segment name. Truncated with an end ellipsis in every row but the expanded one,
 * where it wraps over as many lines as it needs.
 */
function SegmentName({
  node,
  isRenaming,
  isExpanded,
  isSelected,
  isActiveSegment,
  actions,
}: {
  node: SegmentUiNode;
  isRenaming: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  isActiveSegment: boolean;
  actions: SegmentRowActions;
}) {
  const allowUpdate = useWkSelector(mayEditVisibleSegmentation);
  const { segment } = node;
  const displayedName = getSegmentName(segment);

  return (
    <InlineEditableName
      displayedName={displayedName}
      editableValue={segment.name ?? ""}
      placeholder={displayedName}
      isEditing={isRenaming}
      disableEditing={!allowUpdate}
      ellipsis={!isExpanded}
      strong={isSelected || isActiveSegment}
      style={{
        // The only track of the row that may shrink.
        flex: 1,
        minWidth: 0,
        color: isActiveSegment ? "var(--ant-color-primary-active)" : undefined,
        ...(isExpanded
          ? { whiteSpace: "normal", lineHeight: `${EXPANDED_LINE_HEIGHT}px`, textWrap: "pretty" }
          : null),
      }}
      // The truncated rows need the full name on hover; the expanded one shows it anyway.
      title={isExpanded ? undefined : displayedName}
      onClick={() => actions.selectAndJumpTo(segment)}
      onStartEditing={() => actions.startRenaming(node.key)}
      onCommit={(name) => actions.renameSegment(segment, name)}
      onFinishEditing={actions.finishRenaming}
    />
  );
}

/*
 * One segment of the list. A single 30px row, regardless of whether a mesh is loaded:
 *
 *   [checkbox] [color dot] [name ......................] [mesh slot] [hover actions]
 *
 * The checkbox and the indentation are rendered by antd around this title, which is why
 * the row-level treatments (hover/selected tint, the active-segment accent bar, the
 * alignment of the expanded row) are attached to .ant-tree-treenode in _right_menu.less
 * and keyed off the modifier classes set here.
 *
 * The name is the only track that may shrink; everything to its right keeps a fixed
 * width. A statistics value would slot in between the mesh chip and the action bar
 * without changing the row height or the indentation.
 */
export const SegmentNodeTitle = memo(
  ({ node, isCentered, isRenaming, actions, onContextMenu }: Props) => {
    const dispatch = useDispatch();
    const { segment } = node;

    const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
    const mesh = useWkSelector((state) =>
      visibleSegmentationLayer != null
        ? getMeshesForCurrentAdditionalCoordinates(state, visibleSegmentationLayer.name)?.[
            segment.id.toString()
          ]
        : undefined,
    );
    const segmentColorRGBA = useWkSelector(
      (state) => getSegmentColorAsRGBA(state, segment.id),
      (a: Vector4, b: Vector4) => V4.isEqual(a, b),
    );
    const isHovered = useWkSelector(
      (state) => state.temporaryConfiguration.hoveredSegmentId === segment.id,
    );
    // The segment the volume tools currently write to. Marked with the left accent bar,
    // which replaced the brush icon this used to get.
    const isActiveSegment = useWkSelector(
      (state) => getActiveSegmentationTracing(state)?.activeCellId === segment.id,
    );
    const isSelected = useWkSelector((state) =>
      getSelectedIds(state).segments.includes(segment.id),
    );
    // Only a lone selection expands: with several segments selected, growing every one
    // of them would reflow most of the list.
    const isExpanded = useWkSelector((state) => {
      const selectedSegmentIds = getSelectedIds(state).segments;
      return selectedSegmentIds.length === 1 && selectedSegmentIds[0] === segment.id;
    });

    const setHoveredSegmentId = (segmentId: bigint | null) =>
      dispatch(updateTemporarySettingAction("hoveredSegmentId", segmentId));

    return (
      <Flex
        className={classnames("segment-row", {
          "segment-row--active": isActiveSegment,
          "segment-row--expanded": isExpanded,
          "segment-row--hovered-in-viewport": isHovered,
        })}
        align={isExpanded ? "flex-start" : "center"}
        gap={8}
        style={{
          flex: "auto",
          minWidth: 0,
          cursor: "pointer",
          height: isExpanded ? undefined : SEGMENT_ROW_HEIGHT,
          padding: isExpanded ? `${EXPANDED_ROW_PADDING}px 0` : undefined,
        }}
        onMouseEnter={() => setHoveredSegmentId(segment.id)}
        onMouseLeave={() => setHoveredSegmentId(null)}
        onContextMenu={(event) => onContextMenu(node, event)}
      >
        <span
          style={{
            width: COLOR_DOT_SIZE,
            height: COLOR_DOT_SIZE,
            borderRadius: "50%",
            flex: "none",
            backgroundColor: rgbaToCSS(segmentColorRGBA),
            marginTop: isExpanded ? centerOnFirstLine(COLOR_DOT_SIZE) : undefined,
          }}
        />
        <SegmentName
          node={node}
          isRenaming={isRenaming}
          isExpanded={isExpanded}
          isSelected={isSelected}
          isActiveSegment={isActiveSegment}
          actions={actions}
        />
        <Flex
          align="center"
          justify="center"
          style={{
            width: MESH_CHIP_SIZE,
            height: MESH_CHIP_SIZE,
            flex: "none",
            // The expanded row's line box is exactly this tall, so no offset is needed.
            marginTop: isExpanded ? centerOnFirstLine(MESH_CHIP_SIZE) : undefined,
          }}
        >
          <MeshControl segment={segment} mesh={mesh} actions={actions} />
        </Flex>
        <SegmentRowActionBar
          node={node}
          actions={actions}
          isCentered={isCentered}
          isExpanded={isExpanded}
          onContextMenu={onContextMenu}
        />
      </Flex>
    );
  },
);
