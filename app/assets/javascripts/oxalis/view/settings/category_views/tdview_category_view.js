import CheckboxSettingView from "../setting_views/checkbox_setting_view";
import CategoryView from "./category_view";
import constants from "../../../constants";

class TDViewCategoryView extends CategoryView {
  static initClass() {
    this.prototype.caption = "3D View";


    this.prototype.subviewCreatorsList = [

      [
        "tdViewDisplayPlanes", function () {
          return new CheckboxSettingView({
            model: this.model,
            options: {
              name: "tdViewDisplayPlanes",
              displayName: "Display Planes",
            },
          });
        },
      ],
    ];
  }
}
TDViewCategoryView.initClass();

export default TDViewCategoryView;
