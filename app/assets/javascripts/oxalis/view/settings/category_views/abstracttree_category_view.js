import CheckboxSettingView from "../setting_views/checkbox_setting_view";
import CategoryView from "./category_view";

class AbstractTreeCategoryView extends CategoryView {
  static initClass() {
    this.prototype.caption = "Abstract Tree";

    this.prototype.subviewCreatorsList = [

      [
        "renderComments", function () {
          return new CheckboxSettingView({
            model: this.model,
            options: {
              name: "renderComments",
              displayName: "Render Comments",
            },
          });
        },
      ],
    ];
  }
}
AbstractTreeCategoryView.initClass();

export default AbstractTreeCategoryView;
