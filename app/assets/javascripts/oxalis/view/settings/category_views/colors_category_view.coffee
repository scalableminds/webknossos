### define
../setting_views/color_setting_view : ColorSettingView
../setting_views/slider_setting_view : SliderSettingView
./category_view : CategoryView
../../../constants : constants
###

class ColorsCategoryView extends CategoryView


  caption : "Colors"


  subviewCreators :

    "color" : ->

      return new ColorSettingView(
        model : @model
        options :
          name : "color"
          displayName : "Color"
      )
