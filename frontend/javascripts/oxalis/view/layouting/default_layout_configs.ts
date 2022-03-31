// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'utility-types' or its correspo... Remove this comment to see the full error message
import { $Keys } from "utility-types";

/*
 * This file defines:
 *  - the main tabs which can be arranged in WK Core
 *  - the different layout types which specify which tabs exist in which layout and what their default arrangement is
 *  - a `determineLayout` function which decides which layout type has to be chosen
 */
import _ from "lodash";
import { getIsInIframe } from "libs/utils";
import { navbarHeight } from "navbar";
import type { BorderTabType, ControlMode, ViewMode } from "oxalis/constants";
import Constants, {
  ArbitraryViews,
  ArbitraryViewsToName,
  BorderTabs,
  ControlModeEnum,
  OrthoViews,
  OrthoViewsToName,
} from "oxalis/constants";
import * as Utils from "libs/utils";
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
export const currentLayoutVersion = 15;
const layoutHeaderHeight = 20;
const dummyExtent = 500;
export const show3DViewportInArbitrary = false;
const defaultSplitterSize = 1;
export const DEFAULT_LAYOUT_NAME = "Custom Layout";
// The border has two parts: The parts that contains the tabs via a sub-layout and the borderBar.
// The borderBar is (vertical) bar the the borders of the screen that contains a button for each tab of in the border to toggle.
// As we want a flexible layout in the border, we use only on tab containing a sub-layout that is more flexible.
// Additionally, we want to avoid the borderBar. As the borderBars width will be automatically calculated
// when it is set to 0, we use a value near value to make it almost not visible.
const borderBarSize = 1;
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
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'offsetHeight' does not exist on type 'El... Remove this comment to see the full error message
    height = mainContainer.offsetHeight;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'offsetWidth' does not exist on type 'Ele... Remove this comment to see the full error message
    width = mainContainer.offsetWidth;
  }

  // The -1s are a workaround, since otherwise scrollbars
  // would appear from time to time
  return {
    width: width - 1,
    height: height - 1,
  };
};

function Tab(
  name: string,
  id: string,
  component: string,
  enableRenderOnDemand: boolean = true,
): TabNode {
  return {
    type: "tab",
    name,
    component,
    id,
    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ type: "tab"; name: string; component: stri... Remove this comment to see the full error message
    enableRenderOnDemand,
  };
}

function Tabset(children: Array<TabNode>, weight?: number): TabsetNode {
  weight = weight != null ? weight : 100;
  return {
    type: "tabset",
    weight,
    selected: 0,
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

export function getTabDescriptorForBorderTab(borderTab: BorderTabType): TabNode {
  const { name, id, enableRenderOnDemand = true } = borderTab;
  return Tab(name, id, "border-tab", enableRenderOnDemand);
}
const borderTabs: Record<$Keys<typeof BorderTabs>, TabNode> = {};
// Flow does not understand that the values must have a name and an id.
Utils.entries(BorderTabs).forEach(([tabKey, borderTab]: [string, BorderTabType]) => {
  borderTabs[tabKey] = getTabDescriptorForBorderTab(borderTab);
});
const OrthoViewports: Record<$Keys<typeof OrthoViews>, Record<string, any>> = {};
Object.keys(OrthoViews).forEach((viewportId) => {
  // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
  const name = OrthoViewsToName[viewportId];
  OrthoViewports[viewportId] = Tab(name, viewportId, "viewport");
});
const ArbitraryViewports: Record<$Keys<typeof ArbitraryViews>, Record<string, any>> = {};
Object.keys(ArbitraryViews).forEach((viewportId) => {
  // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
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
const additionalHeaderHeightForBorderTabSets = 6;
const subLayoutGlobalSettings: GlobalConfig = {
  ...globalLayoutSettings,
  tabSetEnableDivide: false,
  tabSetHeaderHeight: layoutHeaderHeight + additionalHeaderHeightForBorderTabSets,
  tabSetTabStripHeight: layoutHeaderHeight + additionalHeaderHeightForBorderTabSets,
};

function buildTabsets(setsOfTabs: Array<Array<TabNode>>): Array<TabsetNode> {
  const tabsetWeight = 100 / setsOfTabs.length;
  const tabsets = setsOfTabs.map((tabs) => Tabset(tabs, tabsetWeight));
  return tabsets;
}

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'side' implicitly has an 'any' type.
function buildBorder(side, tabset: Array<TabNode>, width: number, isBorderOpen: boolean): Border {
  const buildTabset = Tabset(tabset, 100);
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
        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ type: "tab"; name: string; id: string; com... Remove this comment to see the full error message
        config: {
          model: {
            global: subLayoutGlobalSettings,
            layout: Row([buildTabset]),
            borders: [],
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
  const rows = rowsOfSetOfTabs.map((setsOfTabs) => {
    const tabsets = buildTabsets(setsOfTabs);
    return Row(tabsets, rowWeight);
  });
  const mainLayout = Row(rows);
  return mainLayout;
}

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'settings' implicitly has an 'any' type.
function buildLayout(settings, borders, mainLayout): ModelConfig {
  return {
    global: settings,
    borders,
    layout: mainLayout,
  };
}

// As long as the content of the left border is not responsive, this border needs a fixed width.
// As soon as the content is responsive the normal DEFAULT_BORDER_WIDTH should be used.
const leftBorderWidth = 365;

const _getDefaultLayouts = () => {
  const isInIframe = getIsInIframe();
  const defaultBorderWidth = isInIframe
    ? Constants.DEFAULT_BORDER_WIDTH_IN_IFRAME
    : Constants.DEFAULT_BORDER_WIDTH;
  const borderIsOpenByDefault = !isInIframe;
  const leftBorder = buildBorder(
    "left",
    [borderTabs.LayerSettingsTab, borderTabs.ControlsAndRenderingSettingsTab],
    leftBorderWidth,
    borderIsOpenByDefault,
  );
  const rightBorderWithSkeleton = buildBorder(
    "right",
    [
      borderTabs.DatasetInfoTabView,
      borderTabs.SkeletonTabView,
      borderTabs.CommentTabView,
      borderTabs.SegmentsView,
      borderTabs.BoundingBoxTab,
      borderTabs.AbstractTreeTab,
      borderTabs.ConnectomeView,
    ],
    defaultBorderWidth,
    borderIsOpenByDefault,
  );
  const rightBorderWithoutSkeleton = buildBorder(
    "right",
    [
      borderTabs.DatasetInfoTabView,
      borderTabs.BoundingBoxTab,
      borderTabs.SegmentsView,
      borderTabs.ConnectomeView,
    ],
    defaultBorderWidth,
    borderIsOpenByDefault,
  );
  const OrthoMainLayout = buildMainLayout([
    // @ts-expect-error ts-migrate(2739) FIXME: Type 'Record<string, any>' is missing the followin... Remove this comment to see the full error message
    [[OrthoViewports.PLANE_XY], [OrthoViewports.PLANE_XZ]],
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'Record<string, any>' is not assignable to ty... Remove this comment to see the full error message
    [[OrthoViewports.PLANE_YZ], [OrthoViewports.TDView]],
  ]);
  const OrthoMainLayout2d = buildMainLayout([
    [
      [
        // @ts-expect-error ts-migrate(2322) FIXME: Type 'Record<string, any>' is not assignable to ty... Remove this comment to see the full error message
        OrthoViewports.PLANE_XY,
        // @ts-expect-error ts-migrate(2322) FIXME: Type 'Record<string, any>' is not assignable to ty... Remove this comment to see the full error message
        OrthoViewports.PLANE_YZ,
        // @ts-expect-error ts-migrate(2322) FIXME: Type 'Record<string, any>' is not assignable to ty... Remove this comment to see the full error message
        OrthoViewports.PLANE_XZ,
        // @ts-expect-error ts-migrate(2322) FIXME: Type 'Record<string, any>' is not assignable to ty... Remove this comment to see the full error message
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
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'Record<string, any>' is not assignable to ty... Remove this comment to see the full error message
    [[ArbitraryViewports.arbitraryViewport]],
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'Record<string, any>[][]' is not assignable t... Remove this comment to see the full error message
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
  // @ts-expect-error ts-migrate(2722) FIXME: Cannot invoke an object which is possibly 'undefin... Remove this comment to see the full error message
  getDefaultLayouts.cache.clear();
};
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'ExtractReturn'.
type Layout = $Keys<ExtractReturn<typeof _getDefaultLayouts>>;
export const getCurrentDefaultLayoutConfig = () => {
  resetDefaultLayouts();
  const defaultLayouts = getDefaultLayouts();
  return {
    OrthoLayoutView: {
      [DEFAULT_LAYOUT_NAME]: defaultLayouts.OrthoLayoutView,
    },
    ArbitraryLayoutView: {
      [DEFAULT_LAYOUT_NAME]: defaultLayouts.ArbitraryLayoutView,
    },
    VolumeTracingView: {
      [DEFAULT_LAYOUT_NAME]: defaultLayouts.VolumeTracingView,
    },
    ArbitraryLayout: {
      [DEFAULT_LAYOUT_NAME]: defaultLayouts.ArbitraryLayout,
    },
    OrthoLayout: {
      [DEFAULT_LAYOUT_NAME]: defaultLayouts.OrthoLayout,
    },
    OrthoLayout2d: {
      [DEFAULT_LAYOUT_NAME]: defaultLayouts.OrthoLayout2d,
    },
    OrthoLayoutView2d: {
      [DEFAULT_LAYOUT_NAME]: defaultLayouts.OrthoLayoutView2d,
    },
    VolumeTracingView2d: {
      [DEFAULT_LAYOUT_NAME]: defaultLayouts.VolumeTracingView2d,
    },
    LastActiveLayouts: {
      OrthoLayoutView: DEFAULT_LAYOUT_NAME,
      ArbitraryLayoutView: DEFAULT_LAYOUT_NAME,
      VolumeTracingView: DEFAULT_LAYOUT_NAME,
      ArbitraryLayout: DEFAULT_LAYOUT_NAME,
      OrthoLayout: DEFAULT_LAYOUT_NAME,
      OrthoLayout2d: DEFAULT_LAYOUT_NAME,
      OrthoLayoutView2d: DEFAULT_LAYOUT_NAME,
      VolumeTracingView2d: DEFAULT_LAYOUT_NAME,
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
