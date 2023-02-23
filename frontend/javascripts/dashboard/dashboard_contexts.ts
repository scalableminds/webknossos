import React from "react";

// Contains the active tab.
export const ActiveTabContext = React.createContext("datasets");
// Contains the tab that is rendered by the current component.
// Most of the dashboard tabs render into a portal next to the tabs (e.g., for
// the search input).
// Since the tabs are not destroyed when switching tabs, multiple tabs can be
// rendered at the same time.
// However, only the active tab should render into the tab portal to avoid that
// the portal is populated twice. This is why, these contexts exist.
export const RenderingTabContext = React.createContext("datasets");
