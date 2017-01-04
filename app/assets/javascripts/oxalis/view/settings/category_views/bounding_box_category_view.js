import CategoryView from "./category_view";
import TextInputSettingView from "../setting_views/text_input_setting_view";
import Utils from "libs/utils";
import Toast from "libs/toast";

class BoundingBoxCategory extends CategoryView {
  static initClass() {
    this.prototype.caption = "Bounding Box";


    this.prototype.subviewCreatorsList = [

      [
        "boundingbox", function () {
          return new TextInputSettingView({
            model: this.model,
            options: {
              name: "boundingBox",
              displayName: "Bounding Box",
              pattern: "(\\d+\\s*,\\s*){5}\\d+",
              title: "Format: minX, minY, minZ, width, height, depth",
              validate: this.validate,
            },
          });
        },
      ],
    ];
  }

  validate(value) {
    let isInvalid;
    const [minX, minY, minZ, width, height, depth] = Utils.stringToNumberArray(value);

    // Width, height and depth of 0 should be allowed as a non-existing bounding box equals 0,0,0,0,0,0
    if (isInvalid = width < 0 || height < 0 || depth < 0) {
      // Unfortunately we cannot use HTML5 form validation here since the text box
      // is not part of a form and a submit event is missing :-(
      Toast.error("Bounding Box: Width, height and depth must be >= 0.", false);

      // Set input as invalid for CSS highlighting
      this.ui.text[0].setCustomValidity("Width, height and depth must be >= 0.");
    } else {
      // reset error state
      this.ui.text[0].setCustomValidity("");
    }

    return !isInvalid;
  }
}
BoundingBoxCategory.initClass();

export default BoundingBoxCategory;
