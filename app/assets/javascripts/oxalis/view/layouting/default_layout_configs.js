// @flow
import _ from "lodash";
import { Pane, Column, Row, Stack } from "./golden_layout_helpers";

// Increment this number to invalidate old layoutConfigs in localStorage
export const currentLayoutVersion = 3;

const LayoutSettings = {
  showPopoutIcon: false,
  showCloseIcon: false,
  showMaximiseIcon: false,
};

const Panes = {
  xy: Pane("XY", "xy"),
  xz: Pane("XZ", "xz"),
  yz: Pane("YZ", "yz"),
  td: Pane("3D", "td"),
  DatasetInfoTabView: Pane("Dataset Info", "DatasetInfoTabView"),
  TreesTabView: Pane("Trees", "TreesTabView"),
  CommentTabView: Pane("Comments", "CommentTabView"),
  AbstractTreeTabView: Pane("Abstract Tree View", "AbstractTreeTabView"),
  arbitraryViewport: Pane("Arbitrary View", "arbitraryViewport"),
  Mappings: Pane("Mappings", "mappingsView"),
};

const OrthoViewsGrid = {
  type: "row",
  content: [Column(Panes.xy, Panes.xz), Column(Panes.yz, Panes.td)],
};

const RightHandColumn = {
  type: "column",
  content: [
    Stack(
      Panes.DatasetInfoTabView,
      Panes.TreesTabView,
      Panes.CommentTabView,
      Panes.AbstractTreeTabView,
    ),
  ],
};

const OrthoLayout = {
  settings: LayoutSettings,
  content: [Row(OrthoViewsGrid, RightHandColumn)],
};

const OrthoLayoutView = {
  settings: LayoutSettings,
  content: [Row(OrthoViewsGrid, Panes.DatasetInfoTabView)],
};

const VolumeTracingView = {
  settings: LayoutSettings,
  content: [Row(OrthoViewsGrid, Panes.Mappings)],
};

const ArbitraryLayout = {
  settings: LayoutSettings,
  content: [Row(Panes.arbitraryViewport, RightHandColumn)],
};

const defaultLayouts = {
  arbitrary: ArbitraryLayout,
  orthogonal: OrthoLayout,
  orthogonalView: OrthoLayoutView,
  VolumeTracingView,
};

export type LayoutKeysType = $Keys<typeof defaultLayouts>;
export default defaultLayouts;
