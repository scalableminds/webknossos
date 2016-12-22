import AbstractTabView from "oxalis/view/abstract_tab_view";
import HelpLogoView from "../settings_views/help_logo_view";
import PlaneUserSettingsView from "../settings_views/plane_user_settings_view";
import DatasetSettingsView from "../settings_views/dataset_settings_view";

class ViewmodeTabView extends AbstractTabView {

  getTabs() {
    return [
      {
        id : "help-tab",
        name : "Help",
        active : true,
        viewClass : HelpLogoView
      },
      {
        id : "dataset-settings-tab",
        name : "Dataset",
        iconClass : "fa fa-cogs",
        viewClass : DatasetSettingsView
      },
      {
        id : "user-settings-tab",
        name : "User",
        iconClass : "fa fa-cogs",
        viewClass : PlaneUserSettingsView
      }
    ];
  }
}

export default ViewmodeTabView;
