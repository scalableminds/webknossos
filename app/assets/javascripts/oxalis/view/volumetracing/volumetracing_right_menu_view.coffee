### define
../abstract_tab_view : AbstractTabView
./right-menu/mapping_info_view : MappingInfoView
###

class VolumeTracingRightMenuView extends AbstractTabView

  getTabs : ->
    [
      {
        id : "volume-mapping-info"
        name : "Mapping Info"
        viewClass : MappingInfoView
      }
    ]
