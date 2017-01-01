import _ from "lodash";
import Marionette from "backbone.marionette";
import Utils from "libs/utils";
import AbstractSettingView from "./abstract_setting_view";

class ColorSettingView extends AbstractSettingView {
  static initClass() {
  
  
    this.prototype.className  = "color-setting-view row";
  
  
    this.prototype.template  = _.template(`\
<div class="col-sm-5">
  <%- displayName %>
</div>
<div class="col-sm-4 col-sm-offset-3">
  <input class="form-control" type="color" value="<%- rgbToHex(value) %>">
</div>\
`);
  
  
    this.prototype.templateContext  =
      {rgbToHex : Utils.rgbToHex};
  
  
    this.prototype.ui  =
      {colorpicker : "input[type=color]"};
  
  
    this.prototype.events  =
      {"change @ui.colorpicker" : "handleChange"};
  }


  handleChange(evt) {

    return this.model.set(this.options.name, Utils.hexToRgb(evt.target.value));
  }


  update(model, value) {

    return this.ui.colorpicker.val(Utils.rgbToHex(value));
  }
}
ColorSettingView.initClass();

export default ColorSettingView;
