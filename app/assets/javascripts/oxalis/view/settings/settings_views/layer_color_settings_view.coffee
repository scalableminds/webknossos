SliderSettingView = require("../setting_views/slider_setting_view")
ColorSettingView  = require("../setting_views/color_setting_view")
_                 = require("lodash")

class LayerColorSettingsView extends Backbone.Marionette.ItemView

  template : _.template("""
    <p><%- displayName %></p>
    <% _.forEach(subviewCreators, function (subview, key) { %>
      <div data-subview="<%- key %>"></div>
    <% }) %>
  """)


  subviewCreators :

    "brightness" : ->

      return new SliderSettingView(
        model : @model
        options :
          name : "#{@options.name}.brightness"
          displayName : "Brightness"
          min : -256
          max : 256
          step : 5
      )

    "contrast" : ->

      return new SliderSettingView(
        model : @model
        options :
          name : "#{@options.name}.contrast"
          displayName : "Contrast"
          min : 0.5
          max : 5
          step : 0.1
      )

    "color" : ->

      return new ColorSettingView(
          model : @model
          options :
            name : "#{@options.name}.color"
            displayName : "Color"
        )

  serializeData : ->

    return _.extend(
      @options,
      { @subviewCreators }
    )


  initialize : ({ @model, @options }) ->

    Backbone.Subviews.add(this)

module.exports = LayerColorSettingsView
