import NumberSettingView from "../setting_views/number_setting_view";
import CheckboxSettingView from "../setting_views/checkbox_setting_view";
import CategoryView from "./category_view";

class TreeCategoryView extends CategoryView {
  static initClass() {
  
  
    this.prototype.caption  = "Trees";
  
    this.prototype.subviewCreatorsList  = [
  
      [
        "activeTree", function() {
  
          return new NumberSettingView({
            model : this.model,
            options : {
              name : "activeTreeId",
              displayName : "Active Tree ID"
            }
          });
        }
      ],
  
      [
        "somaClicking", function() {
  
          return new CheckboxSettingView({
            model : this.model,
            options : {
              enabled : this.model.get("somaClickingAllowed"),
              name : "somaClicking",
              displayName : "Soma Clicking"
            }
          });
        }
      ]
    ];
  }
}
TreeCategoryView.initClass();

export default TreeCategoryView;
