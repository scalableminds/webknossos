import LayerColorSettingsView from "../settings_views/layer_color_settings_view";
import ButtonSettingView from "../setting_views/button_setting_view";
import CategoryView from "./category_view";

class ColorsCategoryView extends CategoryView {
  static initClass() {
    this.prototype.caption = "Colors";


    this.prototype.subviewCreatorsList = [

      [
        "reset", function () {
          return new ButtonSettingView({
            model: this.model,
            options: {
              displayName: "Reset Color Settings",
              callbackName: "reset",
            },
          });
        },
      ],
    ];
  }


  initialize() {
    for (const key of this.model.get("dataLayerNames")) {
      (key => this.subviewCreatorsList.push([key, function () {
        return new LayerColorSettingsView({
          model: this.model,
          options: {
            name: `layers.${key}`,
            displayName: `Layer: ${key}`,
          },
        });
      }]))(key);
    }

    return super.initialize();
  }
}
ColorsCategoryView.initClass();

export default ColorsCategoryView;
