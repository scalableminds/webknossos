import React from "react";

// Contains the active tab.
export const ActiveTabContext = React.createContext("datasets");
// Contains the tab that is rendered by the current component.
// The dataset view is rendered in two tabs and since the tabs are not destroyed
// when switching tabs, two dataset views can be rendered at the same time.
// However, only the active tab should render into the tab portal to avoid that
// the portal is populated twice. This is why, these contexts exist.
export const RenderingTabContext = React.createContext("datasets");
