import { MenuOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { Table, Collapse, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import React from "react";
import { SortableContainerProps, SortEnd } from "react-sortable-hoc";
import { SortableContainer, SortableElement, SortableHandle } from "react-sortable-hoc";
import { settings, settingsTooltips } from "messages";

// Example taken and modified from https://4x.ant.design/components/table/#components-table-demo-drag-sorting-handler.
const { Panel } = Collapse;
interface DataType {
  name: string;
  key: string;
  index: number;
}

const DragHandle = SortableHandle(() => <MenuOutlined style={{ cursor: "grab", color: "#999" }} />);

const columns: ColumnsType<DataType> = [
  {
    title: "Sort",
    dataIndex: "sort",
    width: 30,
    className: "drag-visible",
    render: () => <DragHandle />,
  },
  {
    title: "Name",
    dataIndex: "name",
    className: "drag-visible",
  },
];

const SortableItem = SortableElement(({ name }: { name: string }) => (
  <div key={name}>
    <DragHandle /> {name}
  </div>
));
const SortableBody = SortableContainer((props: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody {...props} />
));

export default function ColorLayerOrderingTable({
  colorLayerNames,
  onChange,
}: {
  colorLayerNames?: string[];
  onChange?: (newColorLayerNames: string[]) => void;
}): JSX.Element {
  const colorLayerObjects =
    colorLayerNames?.map((name, index) => ({ name, index, key: name })) || [];

  const onSortEnd = ({ oldIndex, newIndex }: SortEnd) => {
    debugger;
    if (oldIndex !== newIndex && onChange && colorLayerNames) {
      const movedElement = colorLayerNames[oldIndex];
      let newColorLayerNames = colorLayerNames.filter((_, index) => index === oldIndex);
      newColorLayerNames.splice(newIndex, 0, movedElement);
      onChange(newColorLayerNames);
    }
  };

  const DraggableContainer = (props: SortableContainerProps) => (
    <SortableBody
      useDragHandle
      disableAutoscroll
      helperClass="row-dragging"
      onSortEnd={onSortEnd}
      {...props}
    />
  );

  const DraggableBodyRow: React.FC<any> = ({ className, style, ...restProps }) => {
    // function findIndex base on Table rowKey props and should always be a right array index
    const index = colorLayerObjects.findIndex((row) => row.name === restProps["data-row-key"]);
    return <SortableItem index={index} {...restProps} />;
  };

  const panelTitle = (
    <span style={{ width: "100%" }}>
      {settings.colorLayerOrder}{" "}
      <Tooltip title={settingsTooltips.colorLayerOrder}>
        <InfoCircleOutlined style={{ color: "gray" }} />
      </Tooltip>
    </span>
  );

  return (
    <Collapse
      defaultActiveKey={[]}
      collapsible={colorLayerNames && colorLayerNames.length > 1 ? "header" : "disabled"}
    >
      <Panel header={panelTitle} key="1">
        <Table
          pagination={false}
          dataSource={colorLayerObjects}
          columns={columns}
          rowKey="index"
          components={{
            body: {
              wrapper: DraggableContainer,
              row: DraggableBodyRow,
            },
          }}
        />
      </Panel>
    </Collapse>
  );
}
