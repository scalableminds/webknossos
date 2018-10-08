/*
 * This file defines:
 *  - the main panes which can be arranged in WK Core
 *  - the different layout types which specify which panes exist in which layout and what their default arrangement is
 *  - a `determineLayout` function which decides which layout type has to be chosen
 */

// @flow
import type { ControlMode, Mode } from "oxalis/constants";
import Constants, { ControlModeEnum } from "oxalis/constants";
import { Pane, Column, Row, Stack } from "./golden_layout_helpers";

// Increment this number to invalidate old layoutConfigs in localStorage
export const currentLayoutVersion = 5;

const LayoutSettings = {
  showPopoutIcon: false,
  showCloseIcon: false,
  showMaximiseIcon: false,
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
};

const OrthoViewsGrid = [Column(Panes.xy, Panes.xz), Column(Panes.yz, Panes.td)];
const OrthoViewsGridWideScreen = [Row(Panes.xy, Panes.xz, Panes.yz, Panes.td)];

const SkeletonRightHandColumn = Stack(
  Panes.DatasetInfoTabView,
  Panes.TreesTabView,
  Panes.CommentTabView,
  Panes.AbstractTreeTabView,
  Panes.Mappings,
);
const SkeletonRightHandColumnWideScreen = Row(
  Stack(Panes.DatasetInfoTabView, Panes.Mappings),
  Stack(Panes.TreesTabView, Panes.CommentTabView, Panes.AbstractTreeTabView),
);

const NonSkeletonRightHandColumn = Stack(Panes.DatasetInfoTabView, Panes.Mappings);
const NonSkeletonRightHandColumnWideScreen = Row(Panes.DatasetInfoTabView, Panes.Mappings);

const createLayout = (...content: Array<*>) => ({
  settings: LayoutSettings,
  dimensions: {
    headerHeight: 18,
    borderWidth: 1,
  },
  content,
});

const ArbitraryLayout = createLayout(Row(Panes.arbitraryViewport, SkeletonRightHandColumn));
const OrthoLayout = createLayout(Row(...OrthoViewsGrid, SkeletonRightHandColumn));
const OrthoLayoutWideScreen = createLayout(
  Column(...OrthoViewsGridWideScreen, Row(SkeletonRightHandColumnWideScreen)),
);
const OrthoLayoutView = createLayout(Row(...OrthoViewsGrid, NonSkeletonRightHandColumn));
const OrthoLayoutViewWideScreen = createLayout(
  Column(...OrthoViewsGridWideScreen, Row(NonSkeletonRightHandColumnWideScreen)),
);
const VolumeTracingView = createLayout(Row(...OrthoViewsGrid, NonSkeletonRightHandColumn));
const VolumeTracingViewWideScreen = createLayout(
  Column(...OrthoViewsGridWideScreen, Row(NonSkeletonRightHandColumnWideScreen)),
);
// setting custom height of viewports to wide screens
OrthoLayoutWideScreen.content[0].content[0].height = 60;
OrthoLayoutViewWideScreen.content[0].content[0].height = 60;
VolumeTracingViewWideScreen.content[0].content[0].height = 60;

const getWindowAspectRatio = () => {
  let x = 1;
  let y = 1;
  if (document.body) {
    x = window.innerWidth || document.body.clientWidth || 1;
    y = window.innerHeight || document.body.clientHeight || 1;
  }
  return x / y;
};
let isWideScreenWindow = getWindowAspectRatio() > 1.5;

const defaultLayouts = {
  ArbitraryLayout,
  OrthoLayout: isWideScreenWindow ? OrthoLayoutWideScreen : OrthoLayout,
  OrthoLayoutView: isWideScreenWindow ? OrthoLayoutViewWideScreen : OrthoLayoutView,
  VolumeTracingView: isWideScreenWindow ? VolumeTracingViewWideScreen : VolumeTracingView,
};
export const adjustDefaultLayouts = () => {
  isWideScreenWindow = getWindowAspectRatio() > 1.5;
  defaultLayouts.OrthoLayout = isWideScreenWindow ? OrthoLayoutWideScreen : OrthoLayout;
  defaultLayouts.OrthoLayoutView = isWideScreenWindow ? OrthoLayoutViewWideScreen : OrthoLayoutView;
  defaultLayouts.VolumeTracingView = isWideScreenWindow
    ? VolumeTracingViewWideScreen
    : VolumeTracingView;
};

type Layout = $Keys<typeof defaultLayouts>;

export function determineLayout(controlMode: ControlMode, viewMode: Mode): Layout {
  if (controlMode === ControlModeEnum.VIEW) {
    return "OrthoLayoutView";
  }

  if (!Constants.MODES_SKELETON.includes(viewMode)) {
    return "VolumeTracingView";
  }

  const isArbitraryMode = Constants.MODES_ARBITRARY.includes(viewMode);
  if (isArbitraryMode) {
    return "ArbitraryLayout";
  } else {
    return "OrthoLayout";
  }
}

export type LayoutKeys = $Keys<typeof defaultLayouts>;
export default defaultLayouts;
