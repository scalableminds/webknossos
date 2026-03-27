import { useWkSelector } from "libs/react_hooks";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { hideContextMenuAction } from "viewer/model/actions/ui_actions";
import { ContextMenuInner } from "./context_menu_inner";
import { GenericContextMenuContainer } from "./generic_context_menu_container";

export default function WkContextMenu() {
  const dispatch = useDispatch();
  const contextMenuPosition = useWkSelector((state) => {
    return state.uiInformation.contextInfo.contextMenuPosition;
  });

  const hideContextMenu = useCallback(() => {
    dispatch(hideContextMenuAction());
  }, [dispatch]);

  return (
    <GenericContextMenuContainer
      hideContextMenu={hideContextMenu}
      contextMenuPosition={contextMenuPosition}
    >
      {contextMenuPosition != null ? <ContextMenuInner /> : <div />}
    </GenericContextMenuContainer>
  );
}
