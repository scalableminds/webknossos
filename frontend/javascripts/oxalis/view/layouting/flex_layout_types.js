// @flow
// eslint-disable-next-line no-use-before-define
export type Node = RowNode | TabsetNode | TabNode;

export type TabNode = {
  type: "tab",
  name: string,
  component: string,
  id: string,
};

export type TabsetNode = {
  type: "tabset",
  weight?: number,
  selected?: number,
  children: Array<TabNode>,
};

// eslint-disable-next-line no-use-before-define
export type RowOrTabsetNode = { ...RowNode, ...TabsetNode };

export type RowNode = {
  type: "row",
  weight?: number,
  children: Array<RowOrTabsetNode>,
};

export type Border = {
  type: "border",
  location: "left" | "right" | "top" | "bottom",
  id: string,
  barSize?: number,
  size?: number,
  selected?: 0,
  children: Array<TabNode>,
};

export type GlobalConfig = {
  splitterSize?: number,
  tabEnableRename?: boolean,
  tabEnableClose?: boolean,
  tabSetHeaderHeight?: number,
  tabSetTabStripHeight?: number,
  tabSetEnableDivide?: boolean,
};

export type ModelConfig = {
  global: GlobalConfig,
  borders: Array<Border>,
  layout: mainLayout,
};
