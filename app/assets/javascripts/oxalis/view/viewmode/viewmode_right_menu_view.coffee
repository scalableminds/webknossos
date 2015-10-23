AbstractTabView = require("../abstract_tab_view")
DatasetInfoView = require("./right-menu/dataset_info_view")

class ViewmodeRightMenuView extends AbstractTabView

  getTabs : ->
    [
      {
        id : "tab-info"
        name : "Info"
        viewClass : DatasetInfoView
      }
    ]

module.exports = ViewmodeRightMenuView
