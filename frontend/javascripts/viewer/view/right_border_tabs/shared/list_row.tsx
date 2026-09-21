import { EllipsisOutlined } from "@ant-design/icons";
import { Flex, Typography } from "antd";
import FastTooltip from "components/fast_tooltip";
import type { Vector4 } from "viewer/constants";
import { rgbaToCSS } from "viewer/shaders/utils.glsl";
import ButtonComponent from "viewer/view/components/button_component";

/*
 * The shared building blocks of the refined list rows in the segments and the skeleton
 * tab. Both tabs render the same shell:
 *
 *   [checkbox] [color dot] [name .....................] [extras] [count] [hover actions]
 *
 * Everything that CSS alone can express — the row tints, the accent bar, the alignment of
 * antd's own checkbox and caret — lives in the .list-tree block of _right_menu.less and
 * keys off the modifier classes that the two row components set.
 */

// Every row of a list is this tall, except an expanded one. Kept in sync with
// @list-row-height in _right_menu.less, which needs it for antd's own row element.
export const LIST_ROW_HEIGHT = 30;
export const LIST_ROW_GAP = 8;
// The line box of an expanded row's name. The fixed-size parts of a row are centered on
// it, and the ones taller than it are constrained to it so that they overflow rather than
// grow the row (see RowActionBar and RowTrailingSlot).
export const EXPANDED_LINE_HEIGHT = 20;
// Chosen so that an expanded row whose name still fits on one line is exactly
// LIST_ROW_HEIGHT tall. Selecting such an item then moves nothing below it; only a name
// that actually wraps grows the row, which is the point of expanding it.
export const EXPANDED_ROW_PADDING = (LIST_ROW_HEIGHT - EXPANDED_LINE_HEIGHT) / 2;
// One size for every button in a row, so that the ones which also report state (a loaded
// mesh, the centered segment) read as the same kind of control.
export const ACTION_BUTTON_SIZE = 24;
const COLOR_DOT_SIZE = 9;

// Everything that keeps its size while the name wraps is centered on the first line.
export const centerOnFirstLine = (size: number) => (EXPANDED_LINE_HEIGHT - size) / 2;

// Hides an element until its row is hovered or keyboard-focused (see _right_menu.less).
export const HOVER_ONLY_CLASS = "list-row__on-hover";
// The counterpart: hidden exactly while the row is hovered or keyboard-focused.
const OFF_HOVER_CLASS = "list-row__off-hover";

export const ACTION_BUTTON_STYLE: React.CSSProperties = {
  width: ACTION_BUTTON_SIZE,
  height: ACTION_BUTTON_SIZE,
  minWidth: ACTION_BUTTON_SIZE,
  padding: 0,
  borderRadius: 5,
};

/*
 * The color of the segment or the skeleton the row stands for.
 */
export function ColorDot({ colorRGBA, isExpanded }: { colorRGBA: Vector4; isExpanded?: boolean }) {
  return (
    <span
      style={{
        width: COLOR_DOT_SIZE,
        height: COLOR_DOT_SIZE,
        borderRadius: "50%",
        flex: "none",
        backgroundColor: rgbaToCSS(colorRGBA),
        marginTop: isExpanded ? centerOnFirstLine(COLOR_DOT_SIZE) : undefined,
      }}
    />
  );
}

/*
 * One of the icon buttons of a row's action bar.
 */
export function RowActionButton({
  title,
  icon,
  onClick,
}: {
  title: string;
  icon: React.ReactNode;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  return (
    <FastTooltip title={title} asChild>
      <ButtonComponent
        color="default"
        type="text"
        size="small"
        style={ACTION_BUTTON_STYLE}
        icon={icon}
        onClick={(event) => {
          // A button of the row is a control of its own; clicking it must not also
          // select the row.
          event.stopPropagation();
          onClick(event);
        }}
      />
    </FastTooltip>
  );
}

/*
 * Opens the very same menu as a right-click on the row. Replaces the formerly
 * always-visible ellipsis button.
 */
export function MoreActionsButton({
  onOpenContextMenu,
}: {
  onOpenContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  return (
    <RowActionButton
      title="More actions (also available via right-click)"
      icon={<EllipsisOutlined />}
      onClick={onOpenContextMenu}
    />
  );
}

/*
 * The right-aligned icon buttons that appear while the row is hovered or keyboard-focused
 * (see the visibility rules in _right_menu.less).
 */
export function RowActionBar({
  isExpanded,
  children,
}: {
  isExpanded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Flex
      className={HOVER_ONLY_CLASS}
      align="center"
      gap={1}
      style={{
        flex: "none",
        // Pulls the last button's box out into the row's right padding, so that its icon
        // lines up with the right edge of the fixed-size slots above and below it.
        marginRight: -4,
        // The buttons are taller than the line they sit on, so in an expanded row the bar
        // is constrained to that line and lets them overflow it. Offsetting it instead
        // would leave a margin box taller than the line and grow the row, which would
        // shift the list on every selection change. `align="center"` keeps the buttons
        // centered on the line either way.
        height: isExpanded ? EXPANDED_LINE_HEIGHT : undefined,
      }}
    >
      {children}
    </Flex>
  );
}

/*
 * How many items a row stands for (nodes of a skeleton, segments or skeletons of a
 * group). Right-aligned, in front of the action bar.
 */
export function RowItemCount({ count, title }: { count: number; title: string }) {
  return (
    <Typography.Text
      type="secondary"
      title={title}
      style={{
        flex: "none",
        fontSize: 11,
        // Keeps the counts of consecutive rows in one column.
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {count}
    </Typography.Text>
  );
}

/*
 * The trailing slot of a row: it shows the item count, and the row's actions in its place
 * while the row is hovered or keyboard-focused. Both are stacked in the same grid cell,
 * so the slot is as wide as the wider of the two and swapping them leaves the rest of the
 * row exactly where it was.
 */
export function RowTrailingSlot({
  count,
  countTitle,
  isExpanded,
  children,
}: {
  count: number;
  countTitle: string;
  isExpanded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        flex: "none",
        alignItems: "center",
        justifyItems: "end",
        // Constrained to the first line for the same reason as the action bar it contains.
        height: isExpanded ? EXPANDED_LINE_HEIGHT : undefined,
      }}
    >
      <div className={OFF_HOVER_CLASS} style={{ gridArea: "1 / 1" }}>
        <RowItemCount count={count} title={countTitle} />
      </div>
      <div style={{ gridArea: "1 / 1" }}>
        <RowActionBar>{children}</RowActionBar>
      </div>
    </div>
  );
}
