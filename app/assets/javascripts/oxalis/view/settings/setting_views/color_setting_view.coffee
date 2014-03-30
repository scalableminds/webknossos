### define
libs/utils : Utils
./abstract_setting_view : AbstractSettingView
underscore : _
###

class ColorSettingView extends AbstractSettingView


  className : "color-setting-view row"


  template : _.template("""
    <div class="col-sm-8">
      <%= displayName %>
    </div>
    <div class="col-sm-4">
      <input class="form-control" type="color" value="<%= rgbToHex(value) %>">
    </div>
  """)


  templateHelpers :
    rgbToHex : Utils.rgbToHex


  ui :
    colorpicker : "input[type=color]"


  events :
    "change @ui.colorpicker" : "handleChange"


  handleChange : (evt) ->

    @model.set(@options.name, Utils.hexToRgb(evt.target.value))


  update : (model, value) ->

    @ui.colorpicker.val(Utils.rgbToHex(value))
