### define
../settingviews/checkbox_setting_view : CheckboxSettingView
../settingviews/slider_setting_view : SliderSettingView
./category_view : CategoryView
###

class ControlsCategoryView extends CategoryView


  caption : "Controls"


  subviewCreators :

    "inverseX" : ->

      return new CheckboxSettingView(
        model : @model
        options :
          name : "inverseX"
          displayName : "Inverse X"
      )

    "inverseY" : ->

      return new CheckboxSettingView(
        model : @model
        options :
          name : "inverseY"
          displayName : "Inverse Y"
      )

    "keyboardDelay" : ->

      return new SliderSettingView(
        model : @model
        options :
          name : "keyboardDelay"
          displayName : "Keyboard delay (ms)"
          min : 0
          max : 500
          step : 1
      )
