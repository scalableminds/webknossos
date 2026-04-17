import { createContext } from "react";
import type { ContextMenuContextValue } from "./types";

export const ContextMenuContext = createContext<ContextMenuContextValue>(null);
