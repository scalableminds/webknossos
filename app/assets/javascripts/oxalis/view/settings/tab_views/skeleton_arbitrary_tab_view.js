import AbstractTabView from "oxalis/view/abstract_tab_view";
import SkeletonTracingSettingsView from "../settings_views/skeleton_tracing_settings_view";
import ArbitraryUserSettingsView from "../settings_views/arbitrary_user_settings_view";
import DatasetSettingsView from "../settings_views/dataset_settings_view";

class SkeletonArbitraryTabView extends AbstractTabView {

  getTabs() {
    return [
      {
        id: "tracing-settings-tab",
        name: "Tracing",
        iconClass: "fa fa-cogs",
        viewClass: SkeletonTracingSettingsView,
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
        viewClass: ArbitraryUserSettingsView,
      },
    ];
  }
}

export default SkeletonArbitraryTabView;
