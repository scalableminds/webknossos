import _ from "lodash";
import Marionette from "backbone.marionette";
import AbstractSettingView from "./abstract_setting_view";

class DropdownSettingView extends AbstractSettingView {
  static initClass() {
    this.prototype.className = "dropdown-setting-view row";


    this.prototype.template = _.template(`\
<div class="col-sm-5">
  <%- displayName %>
</div>
<div class="col-sm-7">
  <select class="form-control">
    <% _.forEach(options, function (name, index) { %>
      <option value="<%- index %>" <%- isSelected(value, index) %>><%- name %></option>
    <% }) %>
  </select>
</div>\
`);


    this.prototype.templateContext = {
      isSelected(value, index) {
        return value === index ? "selected" : "";
      },
    };


    this.prototype.ui =
      { select: "select" };


    this.prototype.events =
      { "change @ui.select": "handleChange" };
  }


  handleChange(evt) {
    return this.model.set(this.options.name, parseInt(evt.target.value, 10));
  }


  update(model, value) {
    return this.ui.select.val(parseInt(value, 10));
  }
}
DropdownSettingView.initClass();

export default DropdownSettingView;
