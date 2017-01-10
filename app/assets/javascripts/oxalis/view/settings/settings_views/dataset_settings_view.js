import SettingsView from "./settings_view";
import ColorsCategoryView from "../category_views/colors_category_view";
import QualityCategoryView from "../category_views/quality_category_view";

class DatasetSettingsView extends SettingsView {
  static initClass() {
    this.prototype.id = "dataset-settings";
    this.prototype.className = "flex-column";

    this.prototype.modelName = "datasetConfiguration";


    this.prototype.subviewCreatorsList = [

      [
        "colors-category", function () {
          return new ColorsCategoryView({ model: this.model });
        },
      ],

      [
        "quality-category", function () {
          return new QualityCategoryView({ model: this.model });
        },
      ],
    ];
  }
}
DatasetSettingsView.initClass();

export default DatasetSettingsView;
