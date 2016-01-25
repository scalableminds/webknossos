CheckboxSettingView = require("../setting_views/checkbox_setting_view")
SliderSettingView   = require("../setting_views/slider_setting_view")
CategoryView        = require("./category_view")

class ControlsCategoryView extends CategoryView


  caption : "Controls"


  subviewCreatorsList : [

    [
      "inverseX", ->

        return new CheckboxSettingView(
          model : @model
          options :
            name : "inverseX"
            displayName : "Inverse X"
        )
    ]

    [
      "inverseY", ->

        return new CheckboxSettingView(
          model : @model
          options :
            name : "inverseY"
            displayName : "Inverse Y"
        )
    ]

    [
      "keyboardDelay", ->

        return new SliderSettingView(
          model : @model
          options :
            name : "keyboardDelay"
            displayName : "Keyboard delay (ms)"
            min : 0
            max : 500
            step : 1
        )
    ]
  ]

module.exports = ControlsCategoryView
