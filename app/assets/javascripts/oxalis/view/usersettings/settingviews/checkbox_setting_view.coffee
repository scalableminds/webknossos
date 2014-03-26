### define
./abstract_setting_view : AbstractSettingView
underscore : _
###

class CheckboxSettingView extends AbstractSettingView


  className : "checkbox-setting-view"


  template : _.template("""
    <label class="checkbox">
      <input type="checkbox" <%= boolToChecked(value) %>> <%= displayName %>
    </label>
  """)


  ui :
    checkbox : "input[type=checkbox]"


  templateHelpers :
    boolToChecked : (bool) ->
      return if bool then "checked" else ""


  events :
    "change @ui.checkbox" : "handleChange"


  handleChange : (evt) ->

    @model.set(@options.name, evt.target.checked)


  update : (@model, value) ->

    @ui.checkbox.prop("checked", value)
