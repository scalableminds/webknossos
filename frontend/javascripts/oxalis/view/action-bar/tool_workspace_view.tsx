import { Button, Dropdown, type MenuProps } from "antd";
import {
  // setToolWorkspaceAction,
  updateUserSettingAction,
} from "oxalis/model/actions/settings_actions";
import { Store } from "oxalis/singletons";
import type { ToolWorkspace } from "oxalis/store";

export default function ToolWorkspaceView() {
  const toolWorkspaceItems: MenuProps["items"] = [
    {
      key: "1",
      type: "group",
      label: "Select Workflow",
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
          key: "VOLUME_ANNOTATION",
        },
        {
          label: "Split Segments",
          key: "SPLIT_SEGMENTS",
        },
      ],
    },
  ];

  const handleMenuClick: MenuProps["onClick"] = (args) => {
    const toolWorkspace = args.key;
    Store.dispatch(updateUserSettingAction("toolWorkspace", toolWorkspace as ToolWorkspace));
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

  const toolWorkspaceMenuProps = {
    items: toolWorkspaceItems,
    onClick: handleMenuClick,
  };

  return (
    <Dropdown menu={toolWorkspaceMenuProps}>
      <Button>
        <i className="fas fa-tools" />
      </Button>
    </Dropdown>
  );
}
