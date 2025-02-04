import { Dropdown, type MenuProps } from "antd";
import React from "react";

import Shortcut from "libs/shortcut_component";
import {
  ContextMenuContext,
  GenericContextMenuContainer,
  getNoActionsAvailableMenu,
} from "../context_menu";

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
        overlayClassName="dropdown-overlay-container-for-context-menu"
        open={contextMenuPosition != null}
        getPopupContainer={() => refContent}
        destroyPopupOnHide
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
