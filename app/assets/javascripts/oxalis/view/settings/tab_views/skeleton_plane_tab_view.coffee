### define
oxalis/view/abstract_tab_view : AbstractTabView
../settings_views/skeleton_tracing_settings_view : SkeletonTracingSettingsView
../settings_views/plane_user_settings_view : PlaneUserSettingsView
../settings_views/dataset_settings_view : DatasetSettingsView
###

class SkeletonPlaneTabView extends AbstractTabView

  TABS : [
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
      viewClass : PlaneUserSettingsView
    }
  ]

