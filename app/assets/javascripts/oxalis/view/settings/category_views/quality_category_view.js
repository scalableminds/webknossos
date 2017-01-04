import CheckboxSettingView from "../setting_views/checkbox_setting_view";
import DropdownSettingView from "../setting_views/dropdown_setting_view";
import CategoryView from "./category_view";
import constants from "../../../constants";

class QualityCategoryView extends CategoryView {
  static initClass() {
    this.prototype.caption = "Quality";


    this.prototype.subviewCreatorsList = [

      [
        "fourBit", function () {
          return new CheckboxSettingView({
            model: this.model,
            options: {
              name: "fourBit",
              displayName: "4 Bit",
            },
          });
        },
      ],

      [
        "interpolation", function () {
          return new CheckboxSettingView({
            model: this.model,
            options: {
              name: "interpolation",
              displayName: "Interpolation",
            },
          });
        },
      ],

      [
        "quality", function () {
          return new DropdownSettingView({
            model: this.model,
            options: {
              name: "quality",
              displayName: "Quality",
              options: ["high", "medium", "low"],
            },
          });
        },
      ],
    ];
  }
}
QualityCategoryView.initClass();

export default QualityCategoryView;
