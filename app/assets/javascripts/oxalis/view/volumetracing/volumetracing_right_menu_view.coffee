### define
../abstract_tab_view : AbstractTabView
./right-menu/mapping_info_view : MappingInfoView
###

class SkeletonTracingRightMenuView extends AbstractTabView

  TABS : [
    {
      id : "volume-mapping-info"
      name : "Mapping Info"
      viewClass : MappingInfoView
    }
  ]
