### define
./abstract_setting_view : AbstractSettingView
underscore : _
###

class ColorSettingView extends AbstractSettingView


  className : "color-setting-view"


  template : _.template("""
    <div class="col-sm-8">
      <%= displayName %>
    </div>
    <div class="col-sm-4">
      <input type="color">
    </div>
  """)


  ui :
    colorpicker : "input[type=color]"


  events :
    "change @ui.colorpicker" : "handleChange"


  handleChange : (evt) ->

    @model.set(@options.name, evt.target.value)


  update : (@model, value) ->

    @ui.colorpicker.val(value)
