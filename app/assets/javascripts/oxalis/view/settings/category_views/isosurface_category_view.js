import CategoryView from "./category_view";
import CheckboxSettingView from "../setting_views/checkbox_setting_view";
import SliderSettingView from "../setting_views/slider_setting_view";
import constants from "oxalis/constants";
import app from "app";

class IsosurfaceCategoryView extends CategoryView {
  static initClass() {
  
  
    this.prototype.caption  = "Isosurface View";
  
  
    this.prototype.subviewCreatorsList  = [
  
      [
        "displayIso", function() {
  
          return new CheckboxSettingView({
            model : this.model,
            options : {
              name : "isosurfaceDisplay",
              displayName : "Turn On"
            }
          });
        }
      ],
  
      [
        "boundingBox", function() {
  
          return new SliderSettingView({
            model : this.model,
            options : {
              name : "isosurfaceBBsize",
              displayName : "Bounding Box Size",
              min : 1,
              max : 10,
              step : 0.1
            }
          });
        }
      ],
  
      [
        "resolution", function() {
  
          return new SliderSettingView({
            model : this.model,
            options : {
              name : "isosurfaceResolution",
              displayName : "Resolution",
              min : 40,
              max : 400,
              step : 1
            }
          });
        }
      ]
    ];
  }


  initialize() {

    super.initialize();
    if (app.oxalis.model.volumeTracing == null) { return this.hide(); }
  }
}
IsosurfaceCategoryView.initClass();

export default IsosurfaceCategoryView;
