import { Badge, Button, ConfigProvider, Dropdown, type MenuProps } from "antd";
import type { Toolkit } from "oxalis/model/accessors/tool_accessor";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { Store } from "oxalis/singletons";
import { NARROW_BUTTON_STYLE } from "./toolbar_view";
import { useSelector } from "react-redux";
import { OxalisState } from "oxalis/store";

export default function ToolkitView() {
  const activeToolkit = useSelector((state: OxalisState) => state.userConfiguration.activeToolkit);
  const toolkitItems: MenuProps["items"] = [
    {
      key: "1",
      type: "group",
      label: "Select Toolkit",
      children: [
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
      ],
    },
  ];

  const handleMenuClick: MenuProps["onClick"] = (args) => {
    const toolkit = args.key;
    Store.dispatch(updateUserSettingAction("activeToolkit", toolkit as Toolkit));
    // Unfortunately, antd doesn't provide the original event here
    // which is why we have to blur using document.activeElement.
    // Additionally, we need a timeout since the blurring would be done
    // to early, otherwise.
    setTimeout(() => {
      if (document.activeElement != null) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'blur' does not exist on type 'Element'.
        document.activeElement.blur();
      }
    }, 100);
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
