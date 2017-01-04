import constants from "oxalis/constants";
import CategoryView from "./category_view";
import NumberSettingView from "../setting_views/number_setting_view";
import ButtonSettingView from "../setting_views/button_setting_view";

class CellCategoryView extends CategoryView {
  static initClass() {
    this.prototype.caption = "Cells";


    this.prototype.subviewCreatorsList = [

      [
        "mappedActiveCellId", function () {
          return new NumberSettingView({
            model: this.model,
            options: {
              name: "mappedActiveCellId",
              displayName: "Active Cell ID",
            },
          });
        },
      ],

      [
        "createCell", function () {
          return new ButtonSettingView({
            model: this.model,
            options: {
              displayName: "Create new Cell",
              callbackName: "createCell",
            },
          });
        },
      ],
    ];
  }
}
CellCategoryView.initClass();

export default CellCategoryView;
