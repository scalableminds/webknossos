import Constants from "oxalis/constants";
import NumberSettingView from "../setting_views/number_setting_view";
import CheckboxSettingView from "../setting_views/checkbox_setting_view";
import SliderSettingView from "../setting_views/slider_setting_view";
import ButtonSettingView from "../setting_views/button_setting_view";
import CategoryView from "./category_view";

class NodeCategoryView extends CategoryView {
  static initClass() {
    this.prototype.caption = "Nodes";

    this.prototype.subviewCreatorsList = [

      [
        "activeNode", function () {
          return new NumberSettingView({
            model: this.model,
            options: {
              name: "activeNodeId",
              displayName: "Active Node ID",
            },
          });
        },
      ],

      [
        "radius", function () {
          return new SliderSettingView({
            model: this.model,
            options: {
              name: "radius",
              displayName: "Radius",
              min: 1,
              max: 5000,
              step: 1,
            },
          });
        },
      ],

      [
        "particleSize", function () {
          return new SliderSettingView({
            model: this.model,
            options: {
              name: "particleSize",
              displayName: "Particle Size",
              min: Constants.MIN_PARTICLE_SIZE,
              max: Constants.MAX_PARTICLE_SIZE,
              step: 0.1,
            },
          });
        },
      ],

      [
        "overrideNodeRadius", function () {
          return new CheckboxSettingView({
            model: this.model,
            options: {
              name: "overrideNodeRadius",
              displayName: "Override Radius",
            },
          });
        },
      ],

      [
        "deleteActiveNode", function () {
          return new ButtonSettingView({
            model: this.model,
            options: {
              displayName: "Delete Active Node",
              callbackName: "deleteActiveNode",
            },
          });
        },
      ],
    ];
  }
}
NodeCategoryView.initClass();


export default NodeCategoryView;
