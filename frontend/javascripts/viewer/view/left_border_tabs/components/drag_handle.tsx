import { MenuOutlined } from "@ant-design/icons";
import { useSortable } from "@dnd-kit/sortable";
import FastTooltip from "components/fast_tooltip";

// For color layers, showing the layer's own configured color as a dot (in
// place of the generic grip icon) doubles as an at-a-glance legend, so you
// don't have to expand a layer's settings just to see which color it renders
// with. Segmentation layers have no such per-layer color, so they keep the
// plain grip icon.
function DragHandleIcon({ isDisabled = false, color }: { isDisabled?: boolean; color?: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        justifyContent: "center",
        cursor: isDisabled ? "default" : "grab",
        alignItems: "center",
        opacity: isDisabled ? 0.3 : 0.6,
        marginRight: 8,
      }}
    >
      {color != null ? (
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: color,
            border: "1px solid rgba(0, 0, 0, 0.35)",
          }}
        />
      ) : (
        <MenuOutlined style={{ display: "inline-block" }} />
      )}
    </div>
  );
}

export function DragHandle({ id, color }: { id: string; color?: string }) {
  const { attributes, listeners } = useSortable({
    id,
  });

  return (
    <FastTooltip title="Drag to reorder layers">
      <div {...attributes} {...listeners}>
        <DragHandleIcon color={color} />
      </div>
    </FastTooltip>
  );
}

export function DummyDragHandle({ tooltipTitle, color }: { tooltipTitle: string; color?: string }) {
  return (
    <FastTooltip title={tooltipTitle}>
      <DragHandleIcon isDisabled color={color} />
    </FastTooltip>
  );
}
