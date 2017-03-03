/**
 * skeletontracing_right_menu_view.js
 * @flow weak
 */

import AbstractTabView from "oxalis/view/abstract_tab_view";
import CommentTabView from "oxalis/view/skeletontracing/right-menu/comment_tab/comment_tab_view";
import AbstractTreeView from "oxalis/view/skeletontracing/right-menu/abstract_tree_view";
import ListTreeView from "oxalis/view/skeletontracing/right-menu/list_tree_view";
import DatasetInfoView from "oxalis/view/viewmode/right-menu/dataset_info_view";

class SkeletonTracingRightMenuView extends AbstractTabView {

  getTabs() {
    return [
      {
        id: "tab-info",
        name: "Info",
        viewClass: DatasetInfoView,
      },
      {
        id: "tab-abstract-tree",
        name: "Tree Viewer",
        viewClass: AbstractTreeView,
      },
      {
        id: "tab-trees",
        name: "Trees",
        viewClass: ListTreeView,
      },
      {
        id: "tab-comments",
        name: "Comments",
        viewClass: CommentTabView,
        active: true,
      },
    ];
  }
}

export default SkeletonTracingRightMenuView;
