/*
 * This file defines:
 *  - the main panes which can be arranged in WK Core
 *  - the different layout types which specify which panes exist in which layout and what their default arrangement is
 *  - a `determineLayout` function which decides which layout type has to be chosen
 */

// @flow
import type { ControlModeType, ModeType } from "oxalis/constants";
import Constants, { ControlModeEnum } from "oxalis/constants";
import { Pane, Column, Row, Stack } from "./golden_layout_helpers";

// Increment this number to invalidate old layoutConfigs in localStorage
export const currentLayoutVersion = 4;

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
  Mappings: Pane("Mappings", "MappingInfoView"),
};

const OrthoViewsGrid = Row(Column(Panes.xy, Panes.xz), Column(Panes.yz, Panes.td));

const RightHandColumn = Stack(
  Panes.DatasetInfoTabView,
  Panes.TreesTabView,
  Panes.CommentTabView,
  Panes.AbstractTreeTabView,
);

const createLayout = (...content) => ({
  settings: LayoutSettings,
  dimensions: {
    headerHeight: 31,
  },
  content,
});

const OrthoLayout = createLayout(Row(OrthoViewsGrid, RightHandColumn));
const OrthoLayoutView = createLayout(Row(OrthoViewsGrid, Panes.DatasetInfoTabView));
const VolumeTracingView = createLayout(
  Row(OrthoViewsGrid, Stack(Panes.DatasetInfoTabView, Panes.Mappings)),
);
const ArbitraryLayout = createLayout(Row(Panes.arbitraryViewport, RightHandColumn));

const defaultLayouts = {
  ArbitraryLayout,
  OrthoLayout,
  OrthoLayoutView,
  VolumeTracingView,
};

type LayoutType = $Keys<typeof defaultLayouts>;

export function determineLayout(controlMode: ControlModeType, viewMode: ModeType): LayoutType {
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

export type LayoutKeysType = $Keys<typeof defaultLayouts>;
export default defaultLayouts;
