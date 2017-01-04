import AbstractTabView from "oxalis/view/abstract_tab_view";
import VolumeTracingSettingsView from "../settings_views/volume_tracing_settings_view";
import PlaneUserSettingsView from "../settings_views/plane_user_settings_view";
import DatasetSettingsView from "../settings_views/dataset_settings_view";

class VolumeTabView extends AbstractTabView {

  getTabs() {
    return [
      {
        id: "tracing-settings-tab",
        name: "Tracing",
        iconClass: "fa fa-cogs",
        viewClass: VolumeTracingSettingsView,
        options: { model: this.adapterModel },
      },
      {
        id: "dataset-settings-tab",
        name: "Dataset",
        iconClass: "fa fa-cogs",
        active: true,
        viewClass: DatasetSettingsView,
      },
      {
        id: "user-settings-tab",
        name: "User",
        iconClass: "fa fa-cogs",
        viewClass: PlaneUserSettingsView,
      },
    ];
  }
}

export default VolumeTabView;
