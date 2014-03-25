### define
./abstract_setting_view : AbstractSettingView
underscore : _
###

class CheckboxSettingView extends AbstractSettingView


  template : _.template("""
    <label class="checkbox">
      <input type="checkbox" <%= boolToChecked(value) %>> <%= displayName %>
    </label>
  """)


  templateHelpers :
    boolToChecked : (bool) ->
      return if bool then "checked" else ""


  events :
    "change [type=checkbox]" : "handleCheckboxChange"


  handleCheckboxChange : (evt) ->

    attribute = @options.name
    value = evt.target.checked

    console.log attribute, value
    @model.set(attribute, value)
