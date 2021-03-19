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
  TracingTabs,
  SettingsTabs,
  ArbitraryViews,
} from "oxalis/constants";

// Increment this number to invalidate old layoutConfigs in localStorage
export const currentLayoutVersion = 9;
export const layoutHeaderHeight = 20;
const dummyExtent = 500;
export const show3DViewportInArbitrary = false;

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

function Row(children: Array<any>, weight?: number): Object {
  weight = weight != null ? weight : 100;
  return {
    type: "row",
    weight,
    children,
  };
}

function Tabset(children: Array<any>, weight?: number, defaultSelectedIndex?: number): Object {
  weight = weight != null ? weight : 100;
  return {
    type: "tabset",
    weight,
    selected: defaultSelectedIndex || 0,
    children,
  };
}

function Tab(name: string, id: string, component: string): Object {
  return {
    type: "tab",
    name,
    component,
    id,
  };
}

const infoTabs = {};
Object.entries(TracingTabs).forEach(([tabKey, { name, id }]: any) => {
  infoTabs[tabKey] = Tab(name, id, "tab");
});

const settingsTabs = {};
Object.entries(SettingsTabs).forEach(([tabKey, { name, id }]: any) => {
  settingsTabs[tabKey] = Tab(name, id, "settings-tab");
});

const OrthoViewports = {};
Object.entries(OrthoViews).forEach(([viewportId, { name, id }]: any) => {
  OrthoViewports[viewportId] = Tab(name, id, "viewport");
});

const ArbitraryViewports = {};
Object.entries(ArbitraryViews).forEach(([viewportId, { name, id }]: any) => {
  ArbitraryViewports[viewportId] = Tab(name, id, "viewport");
});

const globalLayoutSettings = {
  splitterSize: 4,
  tabEnableRename: false,
  tabEnableClose: false,
  tabSetHeaderHeight: 20,
  tabSetTabStripHeight: 20,
};

const subLayoutGlobalSettings = {
  ...globalLayoutSettings,
  tabSetEnableDivide: false,
};

function buildTabsets(setsOfTabs: Array<Array<Object>>, defaultSelectedIndex?: number) {
  const tabsetWeight = 100 / setsOfTabs.length;
  const tabsets = setsOfTabs.map(tabs => Tabset(tabs, tabsetWeight, defaultSelectedIndex));
  return tabsets;
}

function buildBorder(
  side,
  setsOfTabs: Array<Array<Object>>,
  width: number,
  defaultSelectedIndex?: number,
): Object {
  const tabsets = buildTabsets(setsOfTabs, defaultSelectedIndex);
  const border = {
    type: "border",
    location: side,
    id: `${side}-border`,
    barSize: 0.01,
    size: width,
    selected: 0,
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
  return border;
}

function buildMainLayout(rowsOfSetOfTabs: any) {
  const rowWeight = 100 / rowsOfSetOfTabs.length;
  const rows = rowsOfSetOfTabs.map(setsOfTabs => {
    const tabsets = buildTabsets(setsOfTabs);
    return Row(tabsets, rowWeight);
  });
  const mainLayout = Row(rows);
  return mainLayout;
}

function buildLayout(settings, borders, mainLayout) {
  return {
    global: settings,
    borders,
    layout: mainLayout,
  };
}

const _getDefaultLayouts = () => {
  const isInIframe = getIsInIframe();
  const defaultBorderWidth = isInIframe ? 200 : 400;
  const leftSiderbar = buildBorder("left", [Object.values(settingsTabs)], 400, 1);
  const rightBorderWithSkeleton = buildBorder(
    "right",
    [
      [infoTabs.DatasetInfoTabView, infoTabs.TreesTabView, infoTabs.CommentTabView],
      [infoTabs.MappingInfoView, infoTabs.MeshesView, infoTabs.AbstractTreeTabView],
    ],
    defaultBorderWidth,
  );
  const rightBorderWithoutSkeleton = buildBorder(
    "right",
    [[infoTabs.DatasetInfoTabView, infoTabs.MappingInfoView, infoTabs.MeshesView]],
    defaultBorderWidth,
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
      [leftSiderbar, withSkeleton ? rightBorderWithSkeleton : rightBorderWithoutSkeleton],
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
      [leftSiderbar, withSkeleton ? rightBorderWithSkeleton : rightBorderWithoutSkeleton],
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
