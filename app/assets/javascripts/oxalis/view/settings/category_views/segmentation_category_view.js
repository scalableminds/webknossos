import SliderSettingView from "../setting_views/slider_setting_view";
import CategoryView from "./category_view";

class SegementationCategoryView extends CategoryView {
  static initClass() {
  
  
    this.prototype.caption  = "Segmentation";
  
    this.prototype.subviewCreatorsList  = [
  
      [
        "segmentOpacity", function() {
  
          return new SliderSettingView({
            model : this.model,
            options : {
              name : "segmentationOpacity",
              displayName : "Segement Opacity",
              min : 0,
              max : 100,
              step : 1
            }
          });
        }
      ]
    ];
  }


  initialize() {

    super.initialize();
    if (app.oxalis.model.getSegmentationBinary() == null) { return this.hide(); }
  }
}
SegementationCategoryView.initClass();

export default SegementationCategoryView;
