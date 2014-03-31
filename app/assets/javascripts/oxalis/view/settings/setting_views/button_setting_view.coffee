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


  initialize : ({ @model, @options }) ->

    @listenTo(this, "render", @afterRender)


  serializeData : ->

    return @options


  afterRender : ->

    @$("button").click(@model[@options.callbackName])
