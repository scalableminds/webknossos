### define
oxalis/view/abstract_tab_view : AbstractTabView
../settings_views/skeleton_tracing_settings_view : SkeletonTracingSettingsView
../settings_views/arbitrary_user_settings_view : ArbitraryUserSettingsView
../settings_views/dataset_settings_view : DatasetSettingsView
###

class SkeletonArbitraryTabView extends AbstractTabView

  getTabs : ->
    [
      {
        id : "tracing-settings-tab"
        name : "Tracing"
        iconClass : "fa fa-cogs"
        viewClass : SkeletonTracingSettingsView
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

