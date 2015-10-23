AbstractTabView       = require("oxalis/view/abstract_tab_view")
HelpLogoView          = require("../settings_views/help_logo_view")
PlaneUserSettingsView = require("../settings_views/plane_user_settings_view")
DatasetSettingsView   = require("../settings_views/dataset_settings_view")

class ViewmodeTabView extends AbstractTabView

  getTabs : ->
    [
      {
        id : "help-tab"
        name : "Help"
        active : true
        viewClass : HelpLogoView
      }
      {
        id : "dataset-settings-tab"
        name : "Dataset"
        iconClass : "fa fa-cogs"
        viewClass : DatasetSettingsView
      }
      {
        id : "user-settings-tab"
        name : "User"
        iconClass : "fa fa-cogs"
        viewClass : PlaneUserSettingsView
      }
    ]

module.exports = ViewmodeTabView
