### define
../settings_views/layer_color_settings_view : LayerColorSettingsView
../setting_views/button_setting_view : ButtonSettingView
./category_view : CategoryView
###

class ColorsCategoryView extends CategoryView


  caption : "Colors"


  subviewCreators :

    "reset" : ->

      return new ButtonSettingView(
        model : @model
        options :
          displayName : "Reset Color Settings"
          callbackName : "reset"
      )


  initialize : ->

    for key in @model.get("dataLayerNames")

      do (key) =>
        @subviewCreators[key] = -> new LayerColorSettingsView(
          model : @model
          options :
            name : "layers.#{key}"
            displayName : "Layer: #{key}"
        )

    super()
