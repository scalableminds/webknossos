import _ from "lodash";
import AbstractSettingView from "oxalis/view/settings/setting_views/abstract_setting_view";

class CheckboxSettingView extends AbstractSettingView {
  static initClass() {
    this.prototype.className = "checkbox-setting-view row";

    this.prototype.template = _.template(`\
<div class="col-sm-5">
  <%- displayName %>
</div>
<div class="col-sm-1">
  <input
    type="checkbox"
    <%- boolToString(value, "checked") %>
    <%- boolToString(!enabled, "disabled") %>
    >
</div>
<div class="col-sm-6"><div>\
`);


    this.prototype.ui =
      { checkbox: "input[type=checkbox]" };


    this.prototype.templateContext = {
      boolToString(bool, string) {
        return bool ? string : "";
      },
    };


    this.prototype.events =
      { "change @ui.checkbox": "handleChange" };
  }


  handleChange(evt) {
    this.model.set(this.options.name, evt.target.checked);
  }


  update(model, value) {
    return this.ui.checkbox.prop("checked", value);
  }
}
CheckboxSettingView.initClass();

export default CheckboxSettingView;
