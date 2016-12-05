SliderSettingView   = require("../setting_views/slider_setting_view")
CheckboxSettingView = require("../setting_views/checkbox_setting_view")
CategoryView        = require("./category_view")
constants           = require("../../../constants")

class FlightCategoryView extends CategoryView


  caption : "Flightoptions"


  subviewCreatorsList : [

    [
      "mouseRotateValue", ->

        return new SliderSettingView(
          model : @model
          options :
            name : "mouseRotateValue"
            displayName : "Mouse Rotation"
            min : 0.0001
            max : 0.02
            step : 0.001
        )
    ]

    [
      "rotateValue", ->

        return new SliderSettingView(
          model : @model
          options :
            name : "rotateValue"
            displayName : "Keyboard Rotation Value"
            min : 0.001
            max : 0.08
            step : 0.001
        )
    ]

    [
      "moveValue3d", ->

        return new SliderSettingView(
          model : @model
          options :
            name : "moveValue3d"
            displayName : "Move Value (nm/s)"
            min : constants.MIN_MOVE_VALUE
            max : constants.MAX_MOVE_VALUE_SLIDER
            step : 10
        )
    ]

    [
      "crosshairSize", ->

        return new SliderSettingView(
          model : @model
          options :
            name : "crosshairSize"
            displayName : "Crosshair Size"
            min : 0.05
            max : 0.5
            step : 0.01
        )
    ]

    [
      "sphericalCapRadius", ->

        return new SliderSettingView(
          model : @model
          options :
            name : "sphericalCapRadius"
            displayName : "Sphere Radius"
            min : 50
            max : 500
            step : 1
        )
    ]

    [
      "clippingDistanceArbitrary", ->

        return new SliderSettingView(
          model : @model
          options :
            name : "clippingDistanceArbitrary"
            displayName : "Clipping Distance"
            min : 1
            max : 127
            step : 1
        )
    ]

    [
      "displayCrosshair", ->

        return new CheckboxSettingView(
          model : @model
          options :
            name : "displayCrosshair"
            displayName : "Show Crosshair"
        )
    ]
  ]

module.exports = FlightCategoryView
