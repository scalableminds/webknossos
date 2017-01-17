import CheckboxSettingView from "../setting_views/checkbox_setting_view";
import SliderSettingView from "../setting_views/slider_setting_view";
import CategoryView from "./category_view";

class ControlsCategoryView extends CategoryView {
  static initClass() {
    this.prototype.caption = "Controls";


    this.prototype.subviewCreatorsList = [

      [
        "inverseX", function () {
          return new CheckboxSettingView({
            model: this.model,
            options: {
              name: "inverseX",
              displayName: "Inverse X",
            },
          });
        },
      ],

      [
        "inverseY", function () {
          return new CheckboxSettingView({
            model: this.model,
            options: {
              name: "inverseY",
              displayName: "Inverse Y",
            },
          });
        },
      ],

      [
        "keyboardDelay", function () {
          return new SliderSettingView({
            model: this.model,
            options: {
              name: "keyboardDelay",
              displayName: "Keyboard delay (ms)",
              min: 0,
              max: 500,
              step: 1,
            },
          });
        },
      ],
    ];
  }
}
ControlsCategoryView.initClass();

export default ControlsCategoryView;
