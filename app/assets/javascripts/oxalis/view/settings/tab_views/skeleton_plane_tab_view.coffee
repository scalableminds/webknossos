AbstractTabView              = require("oxalis/view/abstract_tab_view")
SkeletonTracingSettingsView  = require("../settings_views/skeleton_tracing_settings_view")
PlaneUserSettingsView        = require("../settings_views/plane_user_settings_view")
DatasetSettingsView          = require("../settings_views/dataset_settings_view")
BackboneToOxalisAdapterModel = require("oxalis/model/settings/backbone_to_oxalis_adapter_model")

class SkeletonPlaneTabView extends AbstractTabView

  getTabs : ->
    [
      {
        id : "tracing-settings-tab"
        name : "Tracing"
        iconClass : "fa fa-cogs"
        viewClass : SkeletonTracingSettingsView
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

module.exports = SkeletonPlaneTabView
