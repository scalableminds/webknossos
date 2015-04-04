### define
oxalis/view/abstract_tab_view : AbstractTabView
../settings_views/help_logo_view : HelpLogoView
../settings_views/plane_user_settings_view : PlaneUserSettingsView
../settings_views/dataset_settings_view : DatasetSettingsView
###

class ViewmodeTabView extends AbstractTabView

  TABS : [
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

