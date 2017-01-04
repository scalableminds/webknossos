import Marionette from "backbone.marionette";
import _ from "lodash";
import SettingsView from "./settings_view";
import CellCategoryView from "../category_views/cell_category_view";

class VolumeTracingSettingsView extends SettingsView {
  static initClass() {
    this.prototype.id = "tracing-settings";
    this.prototype.className = "flex-column";

    this.prototype.modelName = "volumeTracingAdapter";


    this.prototype.subviewCreatorsList = [
      [
        "cell-category", function () {
          return new CellCategoryView({ model: this.model });
        },
      ],
    ];
  }
}
VolumeTracingSettingsView.initClass();

export default VolumeTracingSettingsView;
