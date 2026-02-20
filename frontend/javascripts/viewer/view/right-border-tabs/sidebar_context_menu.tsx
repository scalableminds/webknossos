import { Dropdown, type MenuProps } from "antd";
import Shortcut from "libs/shortcut_component";
import React from "react";
import { ContextMenuContext } from "../context-menu/context_menu";
import { GenericContextMenuContainer } from "../context-menu/generic_context_menu_container";
import { getNoActionsAvailableMenu } from "../context-menu/helpers";

function ContextMenuInner(propsWithInputRef: ContextMenuProps) {
  const inputRef = React.useContext(ContextMenuContext);
  const { contextMenuPosition, hideContextMenu } = propsWithInputRef;
  let menu: MenuProps = { items: [] };

  if (contextMenuPosition != null) {
    menu = propsWithInputRef.menu || getNoActionsAvailableMenu(hideContextMenu);
  }

  if (inputRef == null || inputRef.current == null) return null;
  const refContent = inputRef.current;

  return (
    <React.Fragment>
      <Shortcut supportInputElements keys="escape" onTrigger={hideContextMenu} />
      <Dropdown
        menu={menu}
        classNames={{ root: "dropdown-overlay-container-for-context-menu" }}
        open={contextMenuPosition != null}
        getPopupContainer={() => refContent}
        destroyOnHidden
      >
        <div />
      </Dropdown>
    </React.Fragment>
  );
}

type ContextMenuProps = {
  contextMenuPosition: [number, number] | null | undefined;
  hideContextMenu: () => void;
  menu: MenuProps | null | undefined;
  className: string;
};

export function ContextMenuContainer(props: ContextMenuProps) {
  return (
    <GenericContextMenuContainer {...props} className={props.className}>
      <ContextMenuInner {...props} />
    </GenericContextMenuContainer>
  );
}
