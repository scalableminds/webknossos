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
export const currentLayoutVersion = 6;

const LayoutSettings = {
  showPopoutIcon: false,
  showCloseIcon: false,
  showMaximiseIcon: false,
};

export const lastUsedLayout = "lastActive";

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

const SkeletonRightHandColumn = Stack(
  Panes.DatasetInfoTabView,
  Panes.TreesTabView,
  Panes.CommentTabView,
  Panes.AbstractTreeTabView,
  Panes.Mappings,
);

const NonSkeletonRightHandColumn = Stack(Panes.DatasetInfoTabView, Panes.Mappings);

const createLayout = (...content: Array<*>) => ({
  settings: LayoutSettings,
  dimensions: {
    headerHeight: 18,
    borderWidth: 1,
  },
  content,
});

const OrthoLayout = createLayout(Row(...OrthoViewsGrid, SkeletonRightHandColumn));
const OrthoLayoutView = createLayout(Row(...OrthoViewsGrid, NonSkeletonRightHandColumn));
const VolumeTracingView = createLayout(Row(...OrthoViewsGrid, NonSkeletonRightHandColumn));
const ArbitraryLayout = createLayout(Row(Panes.arbitraryViewport, SkeletonRightHandColumn));

const defaultLayouts = {
  ArbitraryLayout,
  OrthoLayout,
  OrthoLayoutView,
  VolumeTracingView,
};

export const defaultLayoutSchema = {
  OrthoLayoutView: {
    "Custom Layout": defaultLayouts.OrthoLayoutView,
    lastActive: "Custom Layout",
  },
  VolumeTracingView: {
    "Custom Layout": defaultLayouts.VolumeTracingView,
    lastActive: "Custom Layout",
  },
  ArbitraryLayout: {
    "Custom Layout": defaultLayouts.ArbitraryLayout,
    lastActive: "Custom Layout",
  },
  OrthoLayout: {
    "Custom Layout": defaultLayouts.OrthoLayout,
    lastActive: "Custom Layout",
  },
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
