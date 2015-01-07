### define
../right_menu_view : RightMenuView
./right-menu/mapping_info_view : MappingInfoView
###

class SkeletonTracingRightMenuView extends RightMenuView

  TABS : [
    {
      id : "volume-mapping-info"
      name : "Mapping Info"
      viewClass : MappingInfoView
    }
  ]
