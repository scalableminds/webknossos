/*
 * This file defines:
 *  - the main tabs which can be arranged in WK Core
 *  - the different layout types which specify which tabs exist in which layout and what their default arrangement is
 *  - a `determineLayout` function which decides which layout type has to be chosen
 */

// @flow
import _ from "lodash";

import { getIsInIframe } from "libs/utils";
import { navbarHeight } from "navbar";
import Constants, {
  type ControlMode,
  ControlModeEnum,
  type ViewMode,
  OrthoViews,
  OrthoViewsToName,
  TracingTabs,
  SettingsTabs,
  ArbitraryViews,
  ArbitraryViewsToName,
} from "oxalis/constants";
import type {
  RowOrTabsetNode,
  RowNode,
  TabsetNode,
  TabNode,
  GlobalConfig,
  Border,
  ModelConfig,
} from "./flex_layout_types";

// Increment this number to invalidate old layoutConfigs in localStorage
export const currentLayoutVersion = 10;
const layoutHeaderHeight = 20;
const dummyExtent = 500;
export const show3DViewportInArbitrary = false;
export const defaultSplitterSize = 3;
// The border has two parts: The parts that contains the tabs via a sub-layout and the borderBar.
// The borderBar is (vertical) bar the the borders of the screen that contains a button for each tab of in the border to toggle.
// As we want a flexible layout in the border, we use only on tab containing a sub-layout that is more flexible.
// Additionally, we want to avoid the borderBar. As the borderBars width will be automatically calculated
// when it is set to 0, we use a value near value to make it almost not visible.
export const borderBarSize = 1;

export const getGroundTruthLayoutRect = () => {
  const mainContainer = document.querySelector(".ant-layout .ant-layout-has-sider");
  let width;
  let height;
  if (!mainContainer) {
    if (window.innerWidth) {
      width = window.innerWidth;
      height = window.innerHeight;
      height -= navbarHeight;
    } else {
      // use fallback values
      height = dummyExtent;
      width = dummyExtent;
    }
  } else {
    height = mainContainer.offsetHeight;
    width = mainContainer.offsetWidth;
  }
  // The -1s are a workaround, since otherwise scrollbars
  // would appear from time to time
  return { width: width - 1, height: height - 1 };
};

function Tab(name: string, id: string, component: string): TabNode {
  return {
    type: "tab",
    name,
    component,
    id,
  };
}

function Tabset(
  children: Array<TabNode>,
  weight?: number,
  defaultSelectedIndex?: number,
): TabsetNode {
  weight = weight != null ? weight : 100;
  return {
    type: "tabset",
    weight,
    selected: defaultSelectedIndex || 0,
    children,
  };
}

function Row(children: Array<RowOrTabsetNode>, weight?: number): RowNode {
  weight = weight != null ? weight : 100;
  return {
    type: "row",
    weight,
    children,
  };
}

const infoTabs = {};
// Flow does not understand that the values must have a name and an id.
Object.entries(TracingTabs).forEach(([tabKey, { name, id }]: any) => {
  infoTabs[tabKey] = Tab(name, id, "right-border-tab");
});

const settingsTabs = {};
Object.entries(SettingsTabs).forEach(([tabKey, { name, id }]: any) => {
  settingsTabs[tabKey] = Tab(name, id, "settings-tab");
});

const OrthoViewports = {};
Object.keys(OrthoViews).forEach(viewportId => {
  const name = OrthoViewsToName[viewportId];
  OrthoViewports[viewportId] = Tab(name, viewportId, "viewport");
});

const ArbitraryViewports = {};
Object.keys(ArbitraryViews).forEach(viewportId => {
  const name = ArbitraryViewsToName[viewportId];
  ArbitraryViewports[viewportId] = Tab(name, viewportId, "viewport");
});

const globalLayoutSettings: GlobalConfig = {
  splitterSize: defaultSplitterSize,
  tabEnableRename: false,
  tabEnableClose: false,
  tabSetHeaderHeight: layoutHeaderHeight,
  tabSetTabStripHeight: layoutHeaderHeight,
};

const subLayoutGlobalSettings: GlobalConfig = {
  ...globalLayoutSettings,
  tabSetEnableDivide: false,
  tabSetHeaderHeight: layoutHeaderHeight + 6,
  tabSetTabStripHeight: layoutHeaderHeight + 6,
};

function buildTabsets(
  setsOfTabs: Array<Array<TabNode>>,
  defaultSelectedIndex?: number,
): Array<TabsetNode> {
  const tabsetWeight = 100 / setsOfTabs.length;
  const tabsets = setsOfTabs.map(tabs => Tabset(tabs, tabsetWeight, defaultSelectedIndex));
  return tabsets;
}

function buildBorder(
  side,
  setsOfTabs: Array<Array<TabNode>>,
  width: number,
  isBorderOpen: boolean,
  defaultSelectedIndex?: number,
): Border {
  const tabsets = buildTabsets(setsOfTabs, defaultSelectedIndex);
  const border: Border = {
    type: "border",
    location: side,
    id: `${side}-border`,
    barSize: borderBarSize,
    size: width,
    children: [
      {
        type: "tab",
        name: "container",
        id: `${side}-border-tab-container`,
        component: "sub",
        config: {
          model: {
            global: subLayoutGlobalSettings,
            layout: Row([Row(tabsets)]),
          },
        },
      },
    ],
  };
  if (isBorderOpen) {
    border.selected = 0;
  }
  return border;
}

function buildMainLayout(rowsOfSetOfTabs: Array<Array<Array<TabNode>>>): RowNode {
  const rowWeight = 100 / rowsOfSetOfTabs.length;
  const rows = rowsOfSetOfTabs.map(setsOfTabs => {
    const tabsets = buildTabsets(setsOfTabs);
    return Row(tabsets, rowWeight);
  });
  const mainLayout = Row(rows);
  return mainLayout;
}

function buildLayout(settings, borders, mainLayout): ModelConfig {
  return {
    global: settings,
    borders,
    layout: mainLayout,
  };
}

const _getDefaultLayouts = () => {
  const isInIframe = getIsInIframe();
  const defaultBorderWidth = isInIframe
    ? Constants.DEFAULT_BORDER_WIDTH_IN_IFRAME
    : Constants.DEFAULT_BORDER_WIDTH;
  const borderIsOpenByDefault = !isInIframe;
  const leftBorder = buildBorder(
    "left",
    [((Object.values(settingsTabs): any): Array<TabNode>)],
    defaultBorderWidth,
    borderIsOpenByDefault,
    1,
  );
  const rightBorderWithSkeleton = buildBorder(
    "right",
    [
      [infoTabs.DatasetInfoTabView, infoTabs.TreesTabView, infoTabs.CommentTabView],
      [infoTabs.MappingInfoView, infoTabs.MeshesView, infoTabs.AbstractTreeTabView],
    ],
    defaultBorderWidth,
    borderIsOpenByDefault,
  );
  const rightBorderWithoutSkeleton = buildBorder(
    "right",
    [[infoTabs.DatasetInfoTabView, infoTabs.MappingInfoView, infoTabs.MeshesView]],
    defaultBorderWidth,
    borderIsOpenByDefault,
  );
  const OrthoMainLayout = buildMainLayout([
    [[OrthoViewports.PLANE_XY], [OrthoViewports.PLANE_XZ]],
    [[OrthoViewports.PLANE_YZ], [OrthoViewports.TDView]],
  ]);
  const OrthoMainLayout2d = buildMainLayout([
    [
      [
        OrthoViewports.PLANE_XY,
        OrthoViewports.PLANE_YZ,
        OrthoViewports.PLANE_XZ,
        OrthoViewports.TDView,
      ],
    ],
  ]);

  const buildOrthoLayout = (withSkeleton: boolean, is2D: boolean) =>
    buildLayout(
      globalLayoutSettings,
      [leftBorder, withSkeleton ? rightBorderWithSkeleton : rightBorderWithoutSkeleton],
      is2D ? OrthoMainLayout2d : OrthoMainLayout,
    );

  const OrthoLayout = buildOrthoLayout(true, false);
  const OrthoLayoutView = buildOrthoLayout(false, false);
  const VolumeTracingView = buildOrthoLayout(false, false);
  const OrthoLayout2d = buildOrthoLayout(true, true);
  const OrthoLayoutView2d = buildOrthoLayout(false, true);
  const VolumeTracingView2d = buildOrthoLayout(false, true);

  const eventual3DViewportForArbitrary = show3DViewportInArbitrary
    ? [[[OrthoViewports.TDView]]]
    : [];
  const ArbitraryMainLayout = buildMainLayout([
    [[ArbitraryViewports.arbitraryViewport]],
    ...eventual3DViewportForArbitrary,
  ]);
  const buildArbitraryLayout = (withSkeleton: boolean) =>
    buildLayout(
      globalLayoutSettings,
      [leftBorder, withSkeleton ? rightBorderWithSkeleton : rightBorderWithoutSkeleton],
      ArbitraryMainLayout,
    );

  const ArbitraryLayoutView = buildArbitraryLayout(false);
  const ArbitraryLayout = buildArbitraryLayout(true);
  return {
    OrthoLayout,
    OrthoLayoutView,
    ArbitraryLayoutView,
    VolumeTracingView,
    ArbitraryLayout,
    OrthoLayout2d,
    OrthoLayoutView2d,
    VolumeTracingView2d,
  };
};

const getDefaultLayouts = _.memoize(_getDefaultLayouts);

export const resetDefaultLayouts = () => {
  getDefaultLayouts.cache.clear();
};

type ExtractReturn<Fn> = $Call<<T>(() => T) => T, Fn>;
type Layout = $Keys<ExtractReturn<typeof _getDefaultLayouts>>;

export const getCurrentDefaultLayoutConfig = () => {
  resetDefaultLayouts();
  const defaultLayouts = getDefaultLayouts();
  return {
    OrthoLayoutView: {
      "Custom Layout": defaultLayouts.OrthoLayoutView,
    },
    ArbitraryLayoutView: {
      "Custom Layout": defaultLayouts.ArbitraryLayoutView,
    },
    VolumeTracingView: {
      "Custom Layout": defaultLayouts.VolumeTracingView,
    },
    ArbitraryLayout: {
      "Custom Layout": defaultLayouts.ArbitraryLayout,
    },
    OrthoLayout: {
      "Custom Layout": defaultLayouts.OrthoLayout,
    },
    OrthoLayout2d: {
      "Custom Layout": defaultLayouts.OrthoLayout2d,
    },
    OrthoLayoutView2d: {
      "Custom Layout": defaultLayouts.OrthoLayoutView2d,
    },
    VolumeTracingView2d: {
      "Custom Layout": defaultLayouts.VolumeTracingView2d,
    },
    LastActiveLayouts: {
      OrthoLayoutView: "Custom Layout",
      ArbitraryLayoutView: "Custom Layout",
      VolumeTracingView: "Custom Layout",
      ArbitraryLayout: "Custom Layout",
      OrthoLayout: "Custom Layout",
      OrthoLayout2d: "Custom Layout",
      OrthoLayoutView2d: "Custom Layout",
      VolumeTracingView2d: "Custom Layout",
    },
  };
};

export function determineLayout(
  controlMode: ControlMode,
  viewMode: ViewMode,
  is2d: boolean,
): Layout {
  const isArbitraryMode = Constants.MODES_ARBITRARY.includes(viewMode);
  if (controlMode === ControlModeEnum.VIEW) {
    if (isArbitraryMode) {
      return "ArbitraryLayoutView";
    } else {
      return is2d ? "OrthoLayoutView2d" : "OrthoLayoutView";
    }
  }

  if (!Constants.MODES_SKELETON.includes(viewMode)) {
    return is2d ? "VolumeTracingView2d" : "VolumeTracingView";
  }

  if (isArbitraryMode) {
    return "ArbitraryLayout";
  } else {
    return is2d ? "OrthoLayout2d" : "OrthoLayout";
  }
}

export const mapLayoutKeysToLanguage = {
  OrthoLayoutView: "Orthogonal Mode - View Only",
  ArbitraryLayoutView: "Arbitrary Mode - View Only",
  VolumeTracingView: "Volume Mode",
  ArbitraryLayout: "Arbitrary Mode",
  OrthoLayout: "Orthogonal Mode",
  OrthoLayoutView2d: "Orthogonal Mode 2D - View Only",
  VolumeTracingView2d: "Volume Mode 2D",
  OrthoLayout2d: "Orthogonal Mode 2D",
};

export type LayoutKeys = Layout;
export default getDefaultLayouts;
