// @flow

import { OrthoViews, AllTracingTabs } from "oxalis/constants";

const infoTabs = {};
Object.entries(AllTracingTabs).forEach(([tabKey, { name, id }]: any) => {
  infoTabs[tabKey] = {
    type: "tab",
    name,
    component: "tab",
    id,
  };
});

const settingsTabs = {};
Object.entries(AllTracingTabs).forEach(([tabKey, { name, id }]: any) => {
  settingsTabs[tabKey] = {
    type: "tab",
    name,
    component: "settings-tab",
    id,
  };
});

const viewports = {};
Object.keys(AllTracingTabs).forEach(viewportId => {
  viewports[viewportId] = {
    type: "tab",
    name: viewportId,
    component: "viewport",
    id: viewportId,
  };
});

function buildBorder(side, setsOfTabs: Array<Array<Object>>): Object {
  const tabsetWeight = 100 / setsOfTabs.length;
  const tabsets = setsOfTabs.forEach(tabs => ({
    type: "tabset",
    weight: tabsetWeight,
    selected: 0,
    children: [tabs],
  }));
  const border = {
    type: "border",
    location: side,
    id: `${side}-sidebar`,
    barSize: 0.01,
    size: 400,
    children: [
      {
        type: "tab",
        name: "container",
        id: `${side}-sidebar-tab-container`,
        component: "sub",
        config: {
          model: {
            global: { tabSetEnableDivide: false, tabEnableClose: false },
            layout: {
              type: "row",
              weight: 100,
              children: [
                {
                  type: "row",
                  weight: 100,
                  children: [tabsets],
                },
              ],
            },
          },
        },
      },
    ],
  };
  return border;
}

// TODO make a builder for the main layout
const defaultLayout = {
  global: { splitterSize: 4, tabEnableRename: false, tabEnableClose: false, tabEnableDrag: true },
  borders: [
    buildBorder("left", [Object.values(settingsTabs)]),
    buildBorder("right", [
      [infoTabs.DatasetInfoTab, infoTabs.TreesTabView, infoTabs.CommentTabView],
      [infoTabs.MappingInfoView, infoTabs.MeshesView, infoTabs.AbstractTreeTabView],
    ]),
  ],
  layout: {
    type: "row",
    weight: 100,
    children: [
      {
        type: "row",
        weight: 50,
        children: [
          {
            type: "tabset",
            weight: 50,
            selected: 0,
            children: [viewports.PLANE_XY],
          },
          {
            type: "tabset",
            weight: 50,
            selected: 0,
            children: [viewports.PLANE_XZ],
          },
        ],
      },
      {
        type: "row",
        weight: 50,
        children: [
          {
            type: "tabset",
            weight: 50,
            selected: 0,
            children: [viewports.PLANE_YZ],
          },
          {
            type: "tabset",
            weight: 50,
            selected: 0,
            children: [viewports.TDView],
          },
        ],
      },
    ],
  },
};

export default defaultLayout;
