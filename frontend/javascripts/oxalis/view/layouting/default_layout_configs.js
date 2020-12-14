/*
 * This file defines:
 *  - the main panes which can be arranged in WK Core
 *  - the different layout types which specify which panes exist in which layout and what their default arrangement is
 *  - a `determineLayout` function which decides which layout type has to be chosen
 */

// @flow
import _ from "lodash";

import { getIsInIframe } from "libs/utils";
import { navbarHeight } from "navbar";
import Constants, { type ControlMode, ControlModeEnum, type ViewMode } from "oxalis/constants";

import { Pane, Column, Row, Stack } from "./golden_layout_helpers";

// Increment this number to invalidate old layoutConfigs in localStorage
export const currentLayoutVersion = 8;
export const layoutHeaderHeight = 20;
const dummyExtent = 500;
export const show3DViewportInArbitrary = false;

const LayoutSettings = {
  showPopoutIcon: false,
  showCloseIcon: false,
  showMaximiseIcon: true,
  selectionEnabled: true,
};

// While the first parameter to `Pane` is the title of the pane, the second one is an id
// which is used to match the children provided to GoldenLayoutAdapter (in tracing_layout_view)
// with the panes in the layout config.
const Panes = {
  xy: Pane("XY", "xy"),
  xz: Pane("XZ", "xz"),
  yz: Pane("YZ", "yz"),
  td: Pane("3D", "td"),
  DatasetInfoTabView: Pane("Info", "DatasetInfoTabView"),
  TreesTabView: Pane("Trees", "TreesTabView"),
  CommentTabView: Pane("Comments", "CommentTabView"),
  AbstractTreeTabView: Pane("Tree Viewer", "AbstractTreeTabView"),
  arbitraryViewport: Pane("Arbitrary View", "arbitraryViewport"),
  Mappings: Pane("Segmentation", "MappingInfoView"),
  Meshes: Pane("Meshes", "MeshesView"),
};

function setGlContainerWidth(container: Object, width: number) {
  container.width = width;
  return container;
}

const createLayout = (...content: Array<*>) => ({
  settings: LayoutSettings,
  dimensions: {
    headerHeight: layoutHeaderHeight,
    borderWidth: 1,
  },
  content,
});

const SkeletonRightHandColumnItems = [
  Panes.DatasetInfoTabView,
  Panes.TreesTabView,
  Panes.CommentTabView,
  Panes.AbstractTreeTabView,
  Panes.Mappings,
  Panes.Meshes,
];
const SkeletonRightHandColumn = Stack(...SkeletonRightHandColumnItems);

const NonSkeletonRightHandColumnItems = [Panes.DatasetInfoTabView, Panes.Mappings, Panes.Meshes];
const NonSkeletonRightHandColumn = Stack(...NonSkeletonRightHandColumnItems);

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

const _getDefaultLayouts = () => {
  const isInIframe = getIsInIframe();
  const defaultViewportWidthInPercent = 33;
  const defaultViewport2dWidthInPercent = 66;

  let OrthoLayout;
  let OrthoLayoutView;
  let VolumeTracingView;
  let OrthoLayout2d;
  let OrthoLayoutView2d;
  let VolumeTracingView2d;

  if (isInIframe) {
    const getGridWithExtraTabs = tabs => [
      Column(Panes.xy, Panes.xz),
      Column(Panes.yz, Stack(Panes.td, ...tabs)),
    ];
    const getGridWithExtraTabs2d = tabs => [
      Column(Panes.xy, Stack(Panes.xz, Panes.yz, Panes.td, ...tabs)),
    ];

    OrthoLayout = createLayout(Row(...getGridWithExtraTabs(SkeletonRightHandColumnItems)));
    OrthoLayoutView = createLayout(Row(...getGridWithExtraTabs(NonSkeletonRightHandColumnItems)));
    VolumeTracingView = createLayout(Row(...getGridWithExtraTabs(NonSkeletonRightHandColumnItems)));
    OrthoLayout2d = createLayout(Row(...getGridWithExtraTabs2d(SkeletonRightHandColumnItems)));
    OrthoLayoutView2d = createLayout(
      Row(...getGridWithExtraTabs2d(NonSkeletonRightHandColumnItems)),
    );
    VolumeTracingView2d = createLayout(
      Row(...getGridWithExtraTabs2d(NonSkeletonRightHandColumnItems)),
    );
  } else {
    const OrthoViewsGrid = [
      setGlContainerWidth(Column(Panes.xy, Panes.xz), defaultViewportWidthInPercent),
      setGlContainerWidth(Column(Panes.yz, Panes.td), defaultViewportWidthInPercent),
    ];
    const OrthoViewsGrid2d = [
      setGlContainerWidth(
        Column(Stack(Panes.xy, Panes.xz, Panes.yz, Panes.td)),
        defaultViewport2dWidthInPercent,
      ),
    ];

    OrthoLayout = createLayout(Row(...OrthoViewsGrid, SkeletonRightHandColumn));
    OrthoLayoutView = createLayout(Row(...OrthoViewsGrid, NonSkeletonRightHandColumn));
    VolumeTracingView = createLayout(Row(...OrthoViewsGrid, NonSkeletonRightHandColumn));
    OrthoLayout2d = createLayout(Row(...OrthoViewsGrid2d, SkeletonRightHandColumn));
    OrthoLayoutView2d = createLayout(Row(...OrthoViewsGrid2d, NonSkeletonRightHandColumn));
    VolumeTracingView2d = createLayout(Row(...OrthoViewsGrid2d, NonSkeletonRightHandColumn));
  }

  const eventual3DViewportForArbitrary = show3DViewportInArbitrary ? [Panes.td] : [];
  const arbitraryPanes = [Panes.arbitraryViewport, NonSkeletonRightHandColumn].concat(
    eventual3DViewportForArbitrary,
  );
  const ArbitraryLayoutView = createLayout(Row(...arbitraryPanes));
  const arbitraryPanesWithSkeleton = [Panes.arbitraryViewport, SkeletonRightHandColumn].concat(
    eventual3DViewportForArbitrary,
  );
  const ArbitraryLayout = createLayout(Row(...arbitraryPanesWithSkeleton));
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
  ArbitraryLayout: "Arbitray Mode",
  OrthoLayout: "Orthogonal Mode",
  OrthoLayoutView2d: "Orthogonal Mode 2D - View Only",
  VolumeTracingView2d: "Volume Mode 2D",
  OrthoLayout2d: "Orthogonal Mode 2D",
};

export type LayoutKeys = Layout;
export default getDefaultLayouts;
