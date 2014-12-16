### define
../right_menu_view : RightMenuView
./right-menu/comment_tab_view : CommentTabView
./right-menu/abstract_tree_view : AbstractTreeView
./right-menu/list_tree_view : ListTreeView
./right-menu/dataset_info_view : DatasetInfoView
###

class SkeletonTracingRightMenuView extends RightMenuView

  TABS : [
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
    }
    {
      id : "tab-info"
      name : "Info"
      viewClass : DatasetInfoView
    }
  ]

