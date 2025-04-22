import { Badge, Button, Dropdown, type MenuProps } from "antd";
import type { Toolkit } from "oxalis/model/accessors/tool_accessor";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { Store } from "oxalis/singletons";
import type { OxalisState } from "oxalis/store";
import { useSelector } from "react-redux";
import { NARROW_BUTTON_STYLE } from "./toolbar_view";

const toolkitOptions: Array<{ label: string; key: Toolkit }> = [
  {
    label: "All Tools",
    key: "ALL_TOOLS",
  },
  {
    label: "Read Only",
    key: "READ_ONLY_TOOLS",
  },
  {
    label: "Volume",
    key: "VOLUME_TOOLS",
  },
  {
    label: "Split Segments",
    key: "SPLIT_SEGMENTS",
  },
];

export default function ToolkitView() {
  const activeToolkit = useSelector((state: OxalisState) => state.userConfiguration.activeToolkit);
  const toolkitItems: MenuProps["items"] = [
    {
      key: "1",
      type: "group",
      label: "Select Toolkit",
      children: toolkitOptions,
    },
  ];

  const handleMenuClick: MenuProps["onClick"] = (args) => {
    const toolkit = args.key;
    Store.dispatch(updateUserSettingAction("activeToolkit", toolkit as Toolkit));
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'blur' does not exist on type 'Element'.
    args.domEvent.target.blur();
  };

  const toolkitMenuProps = {
    items: toolkitItems,
    onClick: handleMenuClick,
    selectable: true,
    selectedKeys: [activeToolkit],
  };

  return (
    <Dropdown menu={toolkitMenuProps}>
      <Badge
        dot={activeToolkit !== "ALL_TOOLS"}
        style={{
          boxShadow: "none",
          background: "red",
          zIndex: 1000,
        }}
      >
        <Button style={NARROW_BUTTON_STYLE}>
          <i className="fas fa-tools" />
        </Button>
      </Badge>
    </Dropdown>
  );
}
