LayerColorSettingsView = require("../settings_views/layer_color_settings_view")
ButtonSettingView      = require("../setting_views/button_setting_view")
CategoryView           = require("./category_view")

class ColorsCategoryView extends CategoryView


  caption : "Colors"


  subviewCreatorsList : [

    [
      "reset", ->

        return new ButtonSettingView(
          model : @model
          options :
            displayName : "Reset Color Settings"
            callbackName : "reset"
        )
    ]
  ]


  initialize : ->

    for key in @model.get("dataLayerNames")

      do (key) =>
        @subviewCreatorsList.push([key, -> new LayerColorSettingsView(
          model : @model
          options :
            name : "layers.#{key}"
            displayName : "Layer: #{key}"
        )])

    super()

module.exports = ColorsCategoryView
