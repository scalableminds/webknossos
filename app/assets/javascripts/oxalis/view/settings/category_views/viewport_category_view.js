import app from "app";
import CheckboxSettingView from "../setting_views/checkbox_setting_view";
import SliderSettingView from "../setting_views/slider_setting_view";
import DropdownSettingView from "../setting_views/dropdown_setting_view";
import CategoryView from "./category_view";
import constants from "../../../constants";

class ViewportCategoryView extends CategoryView {
  static initClass() {
  
  
    this.prototype.caption  = "Viewport Options";
  
    this.prototype.subviewCreatorsList  = [
  
      [
        "moveValue", function() {
  
          return new SliderSettingView({
            model : this.model.get("user"),
            options : {
              name : "moveValue",
              displayName : "Move Value (nm/s)",
              min : constants.MIN_MOVE_VALUE,
              max : constants.MAX_MOVE_VALUE,
              step : 10
            }
          });
        }
      ],
  
      [
        "zoom", function() {
  
          return new SliderSettingView({
            model : this.model.get("user"),
            options : {
              name : "zoom",
              displayName : "Zoom",
              min : -100,
              max : 100,
              step : 1,
              logScaleBase : Math.pow(this.model.flycam.getMaxZoomStep(), 0.01)
            }
          });
        }
      ],
  
      [
        "scale", function() {
  
          return new SliderSettingView({
            model : this.model.get("user"),
            options : {
              name : "scale",
              displayName : "Viewport Scale",
              min : constants.MIN_SCALE,
              max : constants.MAX_SCALE,
              step : 0.1
            }
          });
        }
      ],
  
      [
        "clippingDistance", function() {
  
          return new SliderSettingView({
            model : this.model.get("user"),
            options : {
              name : "clippingDistance",
              displayName : "Clipping Distance",
              min : 1,
              max : 1000 * app.scaleInfo.baseVoxel,
              step : 1
            }
          });
        }
      ],
  
      [
        "dynamicSpaceDirection", function() {
  
          return new CheckboxSettingView({
            model : this.model.get("user"),
            options : {
              name : "dynamicSpaceDirection",
              displayName : "d/f-Switching"
            }
          });
        }
      ],
  
      [
        "displayCrosshair", function() {
  
          return new CheckboxSettingView({
            model : this.model.get("user"),
            options : {
              name : "displayCrosshair",
              displayName : "Show Crosshairs"
            }
          });
        }
      ]
    ];
  }
}
ViewportCategoryView.initClass();

export default ViewportCategoryView;
