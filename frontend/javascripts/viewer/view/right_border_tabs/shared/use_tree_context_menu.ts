import type { MenuProps } from "antd";
import { useCallback, useRef, useState } from "react";
import { getContextMenuPositionFromEvent } from "viewer/view/context_menu/helpers";

export type TreeContextMenu = {
  contextMenuPosition: [number, number] | null;
  contextMenu: MenuProps | null;
  openContextMenu: (menu: MenuProps, event: React.MouseEvent<HTMLElement>) => void;
  hideContextMenu: () => void;
  // Dragging is disabled while a tree/segment/group is being renamed, so that
  // text selection inside the rename input doesn't start a drag operation.
  onRenameStart: () => void;
  onRenameEnd: () => void;
  getIsRenaming: () => boolean;
};

/*
 * Shared context-menu plumbing for the virtualized trees in the skeleton and
 * segments tabs: the open/close state machine (with the Windows workaround) and
 * the renaming-counter drag guard.
 *
 * `overlayClassName` is the class of the context-menu overlay, used to compute
 * click positions relative to the tab.
 */
export function useTreeContextMenu(overlayClassName: string): TreeContextMenu {
  const [contextMenuPosition, setContextMenuPosition] = useState<[number, number] | null>(null);
  const [contextMenu, setContextMenu] = useState<MenuProps | null>(null);
  const renamingCounter = useRef(0);

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

  const onRenameStart = useCallback(() => {
    renamingCounter.current += 1;
  }, []);
  const onRenameEnd = useCallback(() => {
    renamingCounter.current = Math.max(renamingCounter.current - 1, 0);
  }, []);
  const getIsRenaming = useCallback(() => renamingCounter.current > 0, []);

  return {
    contextMenuPosition,
    contextMenu,
    openContextMenu,
    hideContextMenu,
    onRenameStart,
    onRenameEnd,
    getIsRenaming,
  };
}
