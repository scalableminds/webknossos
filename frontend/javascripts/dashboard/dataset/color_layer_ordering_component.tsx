import { MenuOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { List, Collapse, Tooltip, CollapseProps } from "antd";
import React from "react";
import { SortEnd } from "react-sortable-hoc";
import { SortableContainer, SortableElement, SortableHandle } from "react-sortable-hoc";
import { settings, settingsTooltips } from "messages";

// Example taken and modified from https://4x.ant.design/components/table/#components-table-demo-drag-sorting-handler.

const DragHandle = SortableHandle(() => <MenuOutlined style={{ cursor: "grab", color: "#999" }} />);

const SortableItem = SortableElement(({ name }: { name: string }) => (
  <List.Item key={name}>
    <DragHandle /> {name}
  </List.Item>
));

const SortableLayerSettingsContainer = SortableContainer(({ children }: { children: any }) => {
  return <div style={{ paddingTop: -16, paddingBottom: -16 }}>{children}</div>;
});

export default function ColorLayerOrderingTable({
  colorLayerNames,
  onChange,
}: {
  colorLayerNames?: string[];
  onChange?: (newColorLayerNames: string[]) => void;
}): JSX.Element {
  const onSortEnd = ({ oldIndex, newIndex }: SortEnd) => {
    document.body.classList.remove("is-dragging");
    if (oldIndex !== newIndex && onChange && colorLayerNames) {
      const movedElement = colorLayerNames[oldIndex];
      const newColorLayerNames = colorLayerNames.filter((_, index) => index !== oldIndex);
      newColorLayerNames.splice(newIndex, 0, movedElement);
      onChange(newColorLayerNames);
    }
  };

  const isSettingEnabled = colorLayerNames && colorLayerNames.length > 1;
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
      children: (
        <SortableLayerSettingsContainer
          onSortEnd={onSortEnd}
          onSortStart={() =>
            colorLayerNames &&
            colorLayerNames.length > 1 &&
            document.body.classList.add("is-dragging")
          }
          useDragHandle
        >
          {colorLayerNames?.map((name, index) => (
            <SortableItem key={name} index={index} name={name} />
          ))}
        </SortableLayerSettingsContainer>
      ),
    },
  ];

  return (
    <Collapse
      defaultActiveKey={[]}
      collapsible={isSettingEnabled ? "header" : "disabled"}
      items={collapseItems}
    />
  );
}
