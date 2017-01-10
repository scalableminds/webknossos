import SliderSettingView from "../setting_views/slider_setting_view";
import CheckboxSettingView from "../setting_views/checkbox_setting_view";
import CategoryView from "./category_view";
import constants from "../../../constants";

class FlightCategoryView extends CategoryView {
  static initClass() {
    this.prototype.caption = "Flightoptions";


    this.prototype.subviewCreatorsList = [

      [
        "mouseRotateValue", function () {
          return new SliderSettingView({
            model: this.model,
            options: {
              name: "mouseRotateValue",
              displayName: "Mouse Rotation",
              min: 0.0001,
              max: 0.02,
              step: 0.001,
            },
          });
        },
      ],

      [
        "rotateValue", function () {
          return new SliderSettingView({
            model: this.model,
            options: {
              name: "rotateValue",
              displayName: "Keyboard Rotation Value",
              min: 0.001,
              max: 0.08,
              step: 0.001,
            },
          });
        },
      ],

      [
        "moveValue3d", function () {
          return new SliderSettingView({
            model: this.model,
            options: {
              name: "moveValue3d",
              displayName: "Move Value (nm/s)",
              min: constants.MIN_MOVE_VALUE,
              max: constants.MAX_MOVE_VALUE_SLIDER,
              step: 10,
            },
          });
        },
      ],

      [
        "crosshairSize", function () {
          return new SliderSettingView({
            model: this.model,
            options: {
              name: "crosshairSize",
              displayName: "Crosshair Size",
              min: 0.05,
              max: 0.5,
              step: 0.01,
            },
          });
        },
      ],

      [
        "sphericalCapRadius", function () {
          return new SliderSettingView({
            model: this.model,
            options: {
              name: "sphericalCapRadius",
              displayName: "Sphere Radius",
              min: 50,
              max: 500,
              step: 1,
            },
          });
        },
      ],

      [
        "clippingDistanceArbitrary", function () {
          return new SliderSettingView({
            model: this.model,
            options: {
              name: "clippingDistanceArbitrary",
              displayName: "Clipping Distance",
              min: 1,
              max: 127,
              step: 1,
            },
          });
        },
      ],

      [
        "displayCrosshair", function () {
          return new CheckboxSettingView({
            model: this.model,
            options: {
              name: "displayCrosshair",
              displayName: "Show Crosshair",
            },
          });
        },
      ],
    ];
  }
}
FlightCategoryView.initClass();

export default FlightCategoryView;
