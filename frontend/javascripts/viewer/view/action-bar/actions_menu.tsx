import { DownOutlined } from "@ant-design/icons";
import { Dropdown } from "antd";
import type { SubMenuType } from "antd/es/menu/interface";
import { useWkSelector } from "libs/react_hooks";
import { memo } from "react";
import ButtonComponent from "viewer/view/components/button_component";
import { useTracingViewMenuItems } from "./use_tracing_view_menu_items";

type Props = {
  layoutMenu: SubMenuType | null;
};

function ActionsMenu({ layoutMenu }: Props) {
  // Explicitly use very "precise" selectors to avoid unnecessary re-renders
  const annotationType = useWkSelector((state) => state.annotation.annotationType);
  const annotationId = useWkSelector((state) => state.annotation.annotationId);
  const restrictions = useWkSelector((state) => state.annotation.restrictions);
  const annotationOwner = useWkSelector((state) => state.annotation.owner);

  const task = useWkSelector((state) => state.task);
  const activeUser = useWkSelector((state) => state.activeUser);
  const isAnnotationLockedByUser = useWkSelector((state) => state.annotation.isLockedByOwner);

  const menuItems = useTracingViewMenuItems(
    {
      restrictions,
      task,
      annotationType,
      annotationId,
      activeUser,
      isAnnotationLockedByUser,
      annotationOwner,
    },
    layoutMenu,
  );

  return (
    <div>
      <Dropdown menu={{ items: menuItems }} trigger={["click"]}>
        <ButtonComponent className="narrow">
          Menu
          <DownOutlined />
        </ButtonComponent>
      </Dropdown>
    </div>
  );
}

export default memo(ActionsMenu);
