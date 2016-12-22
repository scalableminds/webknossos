AbstractTabView = require("../abstract_tab_view")
MappingInfoView = require("./right-menu/mapping_info_view")
DatasetInfoView = require("../viewmode/right-menu/dataset_info_view")

class VolumeTracingRightMenuView extends AbstractTabView

  getTabs : ->
    [
      {
        id : "tab-info"
        name : "Info"
        viewClass : DatasetInfoView
      }
      {
        id : "volume-mapping-info"
        name : "Mapping Info"
        viewClass : MappingInfoView
      }
    ]

module.exports = VolumeTracingRightMenuView
