### define
./abstract_setting_view : AbstractSettingView
underscore : _
###

class ButtonSettingView extends Backbone.Marionette.ItemView


  className : "button-setting-view row"


  template : _.template("""
    <div class="col-sm-12">
      <button type="button" class="btn btn-block btn-default"><%= displayName %></button>
    </div>
  """)

  events :
    "click button" : "handleClick"


  initialize : ({ @model, @options }) ->


  serializeData : ->

    return @options


  handleClick : ->

    @model[@options.callbackName]()
