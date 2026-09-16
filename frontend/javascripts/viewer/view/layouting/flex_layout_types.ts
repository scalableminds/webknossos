export type TabNode = {
  type: "tab";
  name: string;
  component: string;
  id: string;
  enableRenderOnDemand: boolean;
  // Forwarded verbatim by flexlayout-react onto the tab's rendered button element (in addition to
  // its own .flexlayout__tab_button* classes), so it can be targeted in CSS without touching the
  // tab's DOM structure or the shared .flexlayout__tab_button rules other tabs also rely on.
  className?: string;
};
export type TabsetNode = {
  type: "tabset";
  weight?: number;
  selected?: number;
  children: Array<TabNode>;
  maximized?: boolean;
  // Forwarded verbatim by flexlayout-react onto the tabset's .flexlayout__tabset_tabbar_outer
  // element (in addition to its own classes), so a tabset's tab bar can be targeted in CSS
  // without affecting .flexlayout__tabset_tabbar_outer in other tabsets.
  classNameTabStrip?: string;
};

export type RowOrTabsetNode = TabsetNode | RowNode;
export type RowNode = {
  type: "row";
  weight?: number;
  children: Array<RowOrTabsetNode>;
};
export type Border = {
  type: "border";
  location: "left" | "right" | "top" | "bottom";
  id: string;
  barSize?: number;
  size?: number;
  selected?: number;
  children: Array<TabNode>;
};
export type GlobalConfig = {
  splitterSize?: number;
  tabEnableRename?: boolean;
  tabEnableClose?: boolean;
  tabSetHeaderHeight?: number;
  tabSetTabStripHeight?: number;
  tabSetEnableDivide?: boolean;
};
export type ModelConfig = {
  global: GlobalConfig;
  borders: Array<Border>;
  layout: RowNode;
};
