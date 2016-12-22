AbstractTabView  = require("../abstract_tab_view")
CommentTabView   = require("./right-menu/comment_tab/comment_tab_view")
AbstractTreeView = require("./right-menu/abstract_tree_view")
ListTreeView     = require("./right-menu/list_tree_view")
DatasetInfoView  = require("../viewmode/right-menu/dataset_info_view")

class SkeletonTracingRightMenuView extends AbstractTabView

  getTabs : ->
    [
      {
        id : "tab-info"
        name : "Info"
        viewClass : DatasetInfoView
      }
      {
        id : "tab-abstract-tree"
        name : "Tree Viewer"
        viewClass : AbstractTreeView
      }
      {
        id : "tab-trees"
        name : "Trees"
        viewClass : ListTreeView
      }
      {
        id : "tab-comments"
        name : "Comments"
        viewClass : CommentTabView
        active : true
      }
    ]

module.exports = SkeletonTracingRightMenuView
