### define
../setting_views/color_setting_view : ColorSettingView
../setting_views/slider_setting_view : SliderSettingView
./category_view : CategoryView
###

class ColorsCategoryView extends CategoryView


  caption : "Colors"


  subviewCreators :

    "brightness" : ->

      return new SliderSettingView(
        model : @model
        options :
          name : "brightness"
          displayName : "Brightness"
          min : -256
          max : 256
          step : 5
      )

    "contrast" : ->

      return new SliderSettingView(
        model : @model
        options :
          name : "contrast"
          displayName : "Contrast"
          min : 0.5
          max : 5
          step : 0.1
      )

  initialize : ->

    for key, color of @model.get("layerColors")

      @subviewCreators[key] = -> new ColorSettingView(
        model : @model
        options :
          name : "layerColors.#{key}"
          displayName : "Layer: #{key}"
      )

    super()
