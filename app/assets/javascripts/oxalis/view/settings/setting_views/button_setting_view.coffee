_                   = require("lodash")
Marionette          = require("backbone.marionette")
AbstractSettingView = require("./abstract_setting_view")

class ButtonSettingView extends Marionette.View


  className : "button-setting-view row"


  template : _.template("""
    <div class="col-sm-12">
      <button type="button" class="btn btn-block btn-default"><%- displayName %></button>
    </div>
  """)

  events :
    "click button" : "handleClick"


  initialize : ({ @model, @options }) ->


  serializeData : ->

    return @options


  handleClick : ->

    @model[@options.callbackName]()

module.exports = ButtonSettingView
