### define
./abstract_setting_view : AbstractSettingView
underscore : _
###

class CheckboxSettingView extends AbstractSettingView


  className : "checkbox-setting-view"


  template : _.template("""
    <div class="checkbox">
      <%= displayName %>
      <input type="checkbox" <%= boolToChecked(value) %>>
    </div>
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


  update : (model, value) ->

    @ui.checkbox.prop("checked", value)
