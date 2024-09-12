import { MenuOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { List, Collapse, Tooltip, type CollapseProps } from "antd";
import { settings, settingsTooltips } from "messages";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";

// Example taken and modified from https://ant.design/components/table/#components-table-demo-drag-sorting-handler.

function SortableListItem({ colorLayerName }: { colorLayerName: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: colorLayerName,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? "100" : "auto",
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <List.Item id={colorLayerName} ref={setNodeRef} style={style}>
      <MenuOutlined style={{ cursor: "grab", color: "#999" }} {...listeners} {...attributes} />{" "}
      {colorLayerName}
    </List.Item>
  );
}

export default function ColorLayerOrderingTable({
  colorLayerNames,
  onChange,
}: {
  colorLayerNames?: string[];
  onChange?: (newColorLayerNames: string[]) => void;
}) {
  const onSortEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (active && over && colorLayerNames) {
      const oldIndex = colorLayerNames.indexOf(active.id as string);
      const newIndex = colorLayerNames.indexOf(over.id as string);

      document.body.classList.remove("is-dragging");

      if (oldIndex !== newIndex && onChange) {
        const movedElement = colorLayerNames[oldIndex];
        const newColorLayerNames = colorLayerNames.filter((_, index) => index !== oldIndex);
        newColorLayerNames.splice(newIndex, 0, movedElement);
        onChange(newColorLayerNames);
      }
    }
  };

  const isSettingEnabled = colorLayerNames && colorLayerNames.length > 1;
  const sortingItems = isSettingEnabled ? colorLayerNames.map((name) => name) : [];
  const collapsibleDisabledExplanation =
    "The order of layers can only be configured when the dataset has multiple color layers.";

  const panelTitle = (
    <span style={{ width: "100%" }}>
      {settings.colorLayerOrder}{" "}
      <Tooltip
        title={isSettingEnabled ? settingsTooltips.colorLayerOrder : collapsibleDisabledExplanation}
      >
        <InfoCircleOutlined style={{ color: "gray" }} />
      </Tooltip>
    </span>
  );

  const collapseItems: CollapseProps["items"] = [
    {
      label: panelTitle,
      key: "1",
      children: sortingItems.map((name) => <SortableListItem key={name} colorLayerName={name} />),
    },
  ];

  return (
    <DndContext
      autoScroll={false}
      onDragStart={() => {
        colorLayerNames && colorLayerNames.length > 1 && document.body.classList.add("is-dragging");
      }}
      onDragEnd={onSortEnd}
    >
      <SortableContext items={sortingItems} strategy={verticalListSortingStrategy}>
        <Collapse
          defaultActiveKey={[]}
          collapsible={isSettingEnabled ? "header" : "disabled"}
          items={collapseItems}
        />
      </SortableContext>
    </DndContext>
  );
}
