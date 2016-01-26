AbstractTabView              = require("oxalis/view/abstract_tab_view")
VolumeTracingSettingsView    = require("../settings_views/volume_tracing_settings_view")
PlaneUserSettingsView        = require("../settings_views/plane_user_settings_view")
DatasetSettingsView          = require("../settings_views/dataset_settings_view")
BackboneToOxalisAdapterModel = require("oxalis/model/settings/backbone_to_oxalis_adapter_model")

class VolumeTabView extends AbstractTabView

  getTabs : ->
    [
      {
        id : "tracing-settings-tab"
        name : "Tracing"
        iconClass : "fa fa-cogs"
        viewClass : VolumeTracingSettingsView
        options : { model: @adapterModel}
      }
      {
        id : "dataset-settings-tab"
        name : "Dataset"
        iconClass : "fa fa-cogs"
        active : true
        viewClass : DatasetSettingsView
      }
      {
        id : "user-settings-tab"
        name : "User"
        iconClass : "fa fa-cogs"
        viewClass : PlaneUserSettingsView
      }
    ]

module.exports = VolumeTabView
