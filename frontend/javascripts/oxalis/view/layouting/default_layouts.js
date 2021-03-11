// @flow

import { OrthoViews, AllTracingTabs, AllSettingsTabs } from "oxalis/constants";

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
Object.entries(AllSettingsTabs).forEach(([tabKey, { name, id }]: any) => {
  settingsTabs[tabKey] = {
    type: "tab",
    name,
    component: "settings-tab",
    id,
  };
});

const viewports = {};
Object.keys(OrthoViews).forEach(viewportId => {
  viewports[viewportId] = {
    type: "tab",
    name: viewportId,
    component: "viewport",
    id: viewportId,
  };
});

function buildTabset(setsOfTabs: Array<Array<Object>>) {
  const tabsetWeight = 100 / setsOfTabs.length;
  const tabsets = setsOfTabs.map(tabs => ({
    type: "tabset",
    weight: tabsetWeight,
    selected: 0,
    children: tabs,
  }));
  return tabsets;
}

function buildBorder(side, setsOfTabs: Array<Array<Object>>): Object {
  const tabsets = buildTabset(setsOfTabs);
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
                  children: tabsets,
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
function buildMainLayout(rowsOfSetOfTabs: any) {
  const rowWeight = 100 / rowsOfSetOfTabs.length;
  const rows = rowsOfSetOfTabs.map(setsOfTabs => {
    const tabsets = buildTabset(setsOfTabs);
    return {
      type: "row",
      weight: rowWeight,
      children: tabsets,
    };
  });
  const mainLayout = {
    type: "row",
    weight: 100,
    children: rows,
  };
  return mainLayout;
}

const defaultLayout = {
  global: { splitterSize: 4, tabEnableRename: false, tabEnableClose: false, tabEnableDrag: true },
  borders: [
    buildBorder("left", [Object.values(settingsTabs)]),
    buildBorder("right", [
      [infoTabs.DatasetInfoTabView, infoTabs.TreesTabView, infoTabs.CommentTabView],
      [infoTabs.MappingInfoView, infoTabs.MeshesView, infoTabs.AbstractTreeTabView],
    ]),
  ],
  layout: buildMainLayout([
    [[viewports.PLANE_XY], [viewports.PLANE_XZ]],
    [[viewports.PLANE_YZ], [viewports.TDView]],
  ]),
};

export default defaultLayout;
