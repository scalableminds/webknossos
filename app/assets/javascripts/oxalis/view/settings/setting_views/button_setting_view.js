import _ from "lodash";
import Marionette from "backbone.marionette";
import AbstractSettingView from "./abstract_setting_view";

class ButtonSettingView extends Marionette.View {
  static initClass() {
  
  
    this.prototype.className  = "button-setting-view row";
  
  
    this.prototype.template  = _.template(`\
<div class="col-sm-12">
  <button type="button" class="btn btn-block btn-default"><%- displayName %></button>
</div>\
`);
  
    this.prototype.events  =
      {"click button" : "handleClick"};
  }


  initialize({ model, options }) {
    this.model = model;
    this.options = options;
  }


  serializeData() {

    return this.options;
  }


  handleClick() {

    return this.model[this.options.callbackName]();
  }
}
ButtonSettingView.initClass();

export default ButtonSettingView;
