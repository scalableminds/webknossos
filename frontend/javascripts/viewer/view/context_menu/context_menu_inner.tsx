import { Dropdown, type MenuProps } from "antd";
import { useWkSelector } from "libs/react_hooks";
import Shortcut from "libs/shortcut_component";
import React, { useContext } from "react";
import { getSegmentIdForPosition } from "viewer/controller/combinations/volume_handlers";
import { ContextMenuContext } from "./context_menu";
import { useNoNodeContextMenuOptions } from "./no_node_context_menu_options";
import { useNodeContextMenuOptions } from "./node_context_menu_options";
import { hideContextMenu } from "./use_context_menu_actions";
import { useContextMenuInfoRows } from "./use_context_menu_info_rows";

export function ContextMenuInner() {
  const contextInfo = useWkSelector((state) => state.uiInformation.contextInfo);

  const {
    globalPosition,
    contextMenuPosition,
    clickedNodeId: maybeClickedNodeId,
    viewport: maybeViewport,
  } = contextInfo;

  const inputRef = useContext(ContextMenuContext);

  const segmentIdAtPosition =
    globalPosition != null && contextMenuPosition != null
      ? getSegmentIdForPosition(globalPosition)
      : 0;

  const { infoRows } = useContextMenuInfoRows(contextInfo, segmentIdAtPosition);

  const isNodeMenu = maybeClickedNodeId != null;

  const nodeOptions = useNodeContextMenuOptions(contextInfo, infoRows);
  const noNodeOptions = useNoNodeContextMenuOptions(contextInfo, segmentIdAtPosition, infoRows);

  const menuItems = maybeViewport == null ? [] : isNodeMenu ? nodeOptions : noNodeOptions;

  const menu: MenuProps = {
    onClick: hideContextMenu,
    style: {
      borderRadius: 6,
    },
    mode: "vertical",
    items: menuItems,
  };

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
