import { MenuOutlined } from "@ant-design/icons";
import { useSortable } from "@dnd-kit/sortable";
import FastTooltip from "components/fast_tooltip";

function DragHandleIcon({ isDisabled = false }: { isDisabled?: boolean }) {
  return (
    <div
      style={{
        display: "inline-flex",
        justifyContent: "center",
        cursor: isDisabled ? "default" : "grab",
        alignItems: "center",
        opacity: isDisabled ? 0.3 : 0.6,
      }}
    >
      <MenuOutlined
        style={{
          display: "inline-block",
          marginRight: 8,
        }}
      />
    </div>
  );
}

export function DragHandle({ id }: { id: string }) {
  const { attributes, listeners } = useSortable({
    id,
  });

  return (
    <div {...attributes} {...listeners}>
      <DragHandleIcon />
    </div>
  );
}

export function DummyDragHandle({ tooltipTitle }: { tooltipTitle: string }) {
  return (
    <FastTooltip title={tooltipTitle}>
      <DragHandleIcon isDisabled />
    </FastTooltip>
  );
}
