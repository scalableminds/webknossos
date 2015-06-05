### define
oxalis/view/abstract_tab_view : AbstractTabView
../settings_views/volume_tracing_settings_view : VolumeTracingSettingsView
../settings_views/plane_user_settings_view : PlaneUserSettingsView
../settings_views/dataset_settings_view : DatasetSettingsView
oxalis/model/settings/backbone_to_oxalis_adapter_model : BackboneToOxalisAdapterModel
###

class VolumeTabView extends AbstractTabView

  getTabs : ->
    [
      {
        id : "tracing-settings-tab"
        name : "Tracing"
        iconClass : "fa fa-cogs"
        viewClass : VolumeTracingSettingsView
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
        viewClass : PlaneUserSettingsView
      }
    ]

