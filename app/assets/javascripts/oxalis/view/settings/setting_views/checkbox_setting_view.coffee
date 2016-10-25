_                   = require("lodash")
Marionette          = require("backbone.marionette")
AbstractSettingView = require("./abstract_setting_view")

class CheckboxSettingView extends AbstractSettingView


  className : "checkbox-setting-view row"

  template : _.template("""
    <div class="col-sm-5">
      <%- displayName %>
    </div>
    <div class="col-sm-1">
      <input type="checkbox" <%- boolToChecked(value) %>>
    </div>
    <div class="col-sm-6"><div>
  """)


  ui :
    checkbox : "input[type=checkbox]"


  templateContext :
    boolToChecked : (bool) ->
      return if bool then "checked" else ""


  events :
    "change @ui.checkbox" : "handleChange"


  handleChange : (evt) ->

    @model.set(@options.name, evt.target.checked)


  update : (model, value) ->

    @ui.checkbox.prop("checked", value)

module.exports = CheckboxSettingView
