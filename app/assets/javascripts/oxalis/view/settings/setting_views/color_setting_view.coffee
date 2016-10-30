_                   = require("lodash")
Marionette          = require("backbone.marionette")
Utils               = require("libs/utils")
AbstractSettingView = require("./abstract_setting_view")

class ColorSettingView extends AbstractSettingView


  className : "color-setting-view row"


  template : _.template("""
    <div class="col-sm-5">
      <%- displayName %>
    </div>
    <div class="col-sm-4 col-sm-offset-3">
      <input class="form-control" type="color" value="<%- rgbToHex(value) %>">
    </div>
  """)


  templateContext :
    rgbToHex : Utils.rgbToHex


  ui :
    colorpicker : "input[type=color]"


  events :
    "change @ui.colorpicker" : "handleChange"


  handleChange : (evt) ->

    @model.set(@options.name, Utils.hexToRgb(evt.target.value))


  update : (model, value) ->

    @ui.colorpicker.val(Utils.rgbToHex(value))

module.exports = ColorSettingView
