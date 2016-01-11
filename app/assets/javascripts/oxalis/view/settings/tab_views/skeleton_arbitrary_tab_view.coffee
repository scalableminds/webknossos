AbstractTabView              = require("oxalis/view/abstract_tab_view")
SkeletonTracingSettingsView  = require("../settings_views/skeleton_tracing_settings_view")
ArbitraryUserSettingsView    = require("../settings_views/arbitrary_user_settings_view")
DatasetSettingsView          = require("../settings_views/dataset_settings_view")
BackboneToOxalisAdapterModel = require("oxalis/model/settings/backbone_to_oxalis_adapter_model")

class SkeletonArbitraryTabView extends AbstractTabView

  getTabs : ->
    [
      {
        id : "tracing-settings-tab"
        name : "Tracing"
        iconClass : "fa fa-cogs"
        viewClass : SkeletonTracingSettingsView
        options : { model: new BackboneToOxalisAdapterModel(@model)}
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
        viewClass : ArbitraryUserSettingsView
      }
    ]

module.exports = SkeletonArbitraryTabView
