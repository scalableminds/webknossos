/*
 * This file defines:
 *  - the main panes which can be arranged in WK Core
 *  - the different layout types which specify which panes exist in which layout and what their default arrangement is
 *  - a `determineLayout` function which decides which layout type has to be chosen
 */

// @flow
import _ from "lodash";
import type { ControlMode, Mode } from "oxalis/constants";
import Constants, { ControlModeEnum } from "oxalis/constants";
import { navbarHeight } from "navbar";
import { Pane, Column, Row, Stack } from "./golden_layout_helpers";
import { headerHeight } from "./tracing_layout_view";
import { getGroundTruthLayoutRect } from "./golden_layout_adapter";

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

function setGlContainerWidth(container: Object, width: number) {
  container.width = width;
  return container;
}

const createLayout = (...content: Array<*>) => ({
  settings: LayoutSettings,
  dimensions: {
    headerHeight: 18,
    borderWidth: 1,
  },
  content,
});

const SkeletonRightHandColumn = Stack(
  Panes.DatasetInfoTabView,
  Panes.TreesTabView,
  Panes.CommentTabView,
  Panes.AbstractTreeTabView,
  Panes.Mappings,
);
const NonSkeletonRightHandColumn = Stack(Panes.DatasetInfoTabView, Panes.Mappings);

const unmemoizedGetDefaultLayouts = () => {
  let { height, width } = getGroundTruthLayoutRect();
  // prevent default height and width
  if (height === undefined || width === undefined) {
    if (window.innerWidth) {
      width = window.innerWidth;
      height = window.innerHeight;
      height -= headerHeight + navbarHeight;
    } else {
      // use fallback values
      height = 500;
      width = 500;
    }
  }
  const viewportWidth = Math.min(((height / 2) * 100) / width, 40);

  const OrthoViewsGrid = [
    setGlContainerWidth(Column(Panes.xy, Panes.xz), viewportWidth),
    setGlContainerWidth(Column(Panes.yz, Panes.td), viewportWidth),
  ];

  const OrthoLayout = createLayout(Row(...OrthoViewsGrid, SkeletonRightHandColumn));
  const OrthoLayoutView = createLayout(Row(...OrthoViewsGrid, NonSkeletonRightHandColumn));
  const VolumeTracingView = createLayout(Row(...OrthoViewsGrid, NonSkeletonRightHandColumn));
  const ArbitraryLayout = createLayout(Row(Panes.arbitraryViewport, SkeletonRightHandColumn));

  return { OrthoLayout, OrthoLayoutView, VolumeTracingView, ArbitraryLayout };
};

const getDefaultLayouts = _.memoize(unmemoizedGetDefaultLayouts);

export const resetDefaultLayouts = () => {
  getDefaultLayouts.cache.clear();
};

type ExtractReturn<Fn> = $Call<<T>(() => T) => T, Fn>;
type Layout = $Keys<ExtractReturn<typeof unmemoizedGetDefaultLayouts>>;

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

export type LayoutKeys = Layout;
export default getDefaultLayouts;
