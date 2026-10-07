import type { MenuProps } from "antd";
import { useCallback, useState } from "react";
import { getContextMenuPositionFromEvent } from "viewer/view/context_menu/helpers";

export type TreeContextMenu = {
  contextMenuPosition: [number, number] | null;
  contextMenu: MenuProps | null;
  openContextMenu: (menu: MenuProps, event: React.MouseEvent<HTMLElement>) => void;
  hideContextMenu: () => void;
};

/*
 * Shared context-menu plumbing for the virtualized trees in the skeleton and
 * segments tabs: the open/close state machine (with the Windows workaround).
 *
 * `overlayClassName` is the class of the context-menu overlay, used to compute
 * click positions relative to the tab.
 */
export function useTreeContextMenu(overlayClassName: string): TreeContextMenu {
  const [contextMenuPosition, setContextMenuPosition] = useState<[number, number] | null>(null);
  const [contextMenu, setContextMenu] = useState<MenuProps | null>(null);

  const hideContextMenu = useCallback(() => {
    setContextMenuPosition(null);
    setContextMenu(null);
  }, []);

  const openContextMenu = useCallback(
    (menu: MenuProps, event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault();
      const [x, y] = getContextMenuPositionFromEvent(event, overlayClassName);
      // On Windows the right click to open the context menu is also triggered for the overlay
      // of the context menu. This causes the context menu to instantly close after opening.
      // Therefore delay the state update so that the context overlay does not get the right
      // click as an event and therefore does not close.
      setTimeout(() => {
        setContextMenuPosition([x, y]);
        setContextMenu(menu);
      }, 0);
    },
    [overlayClassName],
  );

  return {
    contextMenuPosition,
    contextMenu,
    openContextMenu,
    hideContextMenu,
  };
}
