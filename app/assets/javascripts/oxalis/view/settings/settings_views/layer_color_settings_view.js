_                 = require("lodash")
Marionette        = require("backbone.marionette")
Subviews          = require("backbone-subviews")
SliderSettingView = require("../setting_views/slider_setting_view")
ColorSettingView  = require("../setting_views/color_setting_view")

class LayerColorSettingsView extends Marionette.View

  template : _.template("""
    <p><%- displayName %></p>
    <% _.forEach(subviewCreatorsList, function (key_value_pair) { %>
      <div data-subview="<%- key_value_pair[0] %>"></div>
    <% }) %>
  """)


  subviewCreatorsList : [

    [
      "brightness", ->

        return new SliderSettingView(
          model : @model
          options :
            name : "#{@options.name}.brightness"
            displayName : "Brightness"
            min : -256
            max : 256
            step : 5
        )
    ]

    [
      "contrast", ->

        return new SliderSettingView(
          model : @model
          options :
            name : "#{@options.name}.contrast"
            displayName : "Contrast"
            min : 0.5
            max : 5
            step : 0.1
        )
    ]

    [
      "color", ->

        return new ColorSettingView(
            model : @model
            options :
              name : "#{@options.name}.color"
              displayName : "Color"
          )
    ]

  ]

  serializeData : ->

    return _.extend(
      @options,
      { @subviewCreatorsList }
    )


  initialize : ({ @model, @options }) ->

    unless @subviewCreatorsList?
      throw new Error(
        "Subclasses of CategoryView must specify subviewCreatorsList")

    # subviewCreators hash needed for Subviews extension
    @subviewCreators = _.transform(
      @subviewCreatorsList
      (result, [key, value]) -> result[key] = value
      {}
    )

    Subviews.add(this)

module.exports = LayerColorSettingsView
