### define
../abstract_tab_view : AbstractTabView
./right-menu/dataset_info_view : DatasetInfoView
###

class ViewmodeRightMenuView extends AbstractTabView

  TABS : [
    {
      id : "tab-info"
      name : "Info"
      viewClass : DatasetInfoView
    }
  ]

