import { createContext } from "react";
import { GenericContextMenuContainer } from "./generic_context_menu_container";
import { getContextMenuPositionFromEvent, getNoActionsAvailableMenu } from "./helpers";
import type { ContextMenuContextValue } from "./types";
import WkContextMenu from "./wk_context_menu";

export const ContextMenuContext = createContext<ContextMenuContextValue>(null);

export { GenericContextMenuContainer, getContextMenuPositionFromEvent, getNoActionsAvailableMenu };
export default WkContextMenu;
