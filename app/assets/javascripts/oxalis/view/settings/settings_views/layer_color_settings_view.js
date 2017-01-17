import _ from "lodash";
import Marionette from "backbone.marionette";
import Subviews from "backbone-subviews";
import SliderSettingView from "../setting_views/slider_setting_view";
import ColorSettingView from "../setting_views/color_setting_view";

class LayerColorSettingsView extends Marionette.View {
  static initClass() {
    this.prototype.template = _.template(`\
<p><%- displayName %></p>
<% _.forEach(subviewCreatorsList, function (key_value_pair) { %>
  <div data-subview="<%- key_value_pair[0] %>"></div>
<% }) %>\
`);


    this.prototype.subviewCreatorsList = [

      [
        "brightness", function () {
          return new SliderSettingView({
            model: this.model,
            options: {
              name: `${this.options.name}.brightness`,
              displayName: "Brightness",
              min: -256,
              max: 256,
              step: 5,
            },
          });
        },
      ],

      [
        "contrast", function () {
          return new SliderSettingView({
            model: this.model,
            options: {
              name: `${this.options.name}.contrast`,
              displayName: "Contrast",
              min: 0.5,
              max: 5,
              step: 0.1,
            },
          });
        },
      ],

      [
        "color", function () {
          return new ColorSettingView({
            model: this.model,
            options: {
              name: `${this.options.name}.color`,
              displayName: "Color",
            },
          });
        },
      ],

    ];
  }

  serializeData() {
    return _.extend(
      this.options,
      { subviewCreatorsList: this.subviewCreatorsList },
    );
  }


  initialize({ model, options }) {
    this.model = model;
    this.options = options;
    if (this.subviewCreatorsList == null) {
      throw new Error(
        "Subclasses of CategoryView must specify subviewCreatorsList");
    }

    // subviewCreators hash needed for Subviews extension
    this.subviewCreators = _.transform(
      this.subviewCreatorsList,
      (result, [key, value]) => { result[key] = value; },
      {},
    );

    return Subviews.add(this);
  }
}
LayerColorSettingsView.initClass();

export default LayerColorSettingsView;
