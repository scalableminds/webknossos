### define
../setting_views/color_setting_view : ColorSettingView
../setting_views/slider_setting_view : SliderSettingView
./category_view : CategoryView
../../../constants : constants
###

class ColorsCategoryView extends CategoryView


  caption : "Colors"


  subviewCreators : {}


  initialize : ->

    for key, color of @model.get("layerColors")

      @subviewCreators[key] = -> new ColorSettingView(
        model : @model
        options :
          name : "layerColors.#{key}"
          displayName : key
      )

    super()
