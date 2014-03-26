### define
../setting_views/checkbox_setting_view : CheckboxSettingView
../setting_views/slider_setting_view : SliderSettingView
../setting_views/dropdown_setting_view : DropdownSettingView
./category_view : CategoryView
../../../constants : constants
###

class ViewportCategoryView extends CategoryView


  caption : "Viewport"


  subviewCreators :

    "moveValue" : ->

      return new SliderSettingView(
        model : @model
        options :
          name : "moveValue"
          displayName : "Move value (nm/s)"
          min : constants.MIN_MOVE_VALUE
          max : constants.MAX_MOVE_VALUE
          step : 10
      )

    "zoom" : ->

      return new SliderSettingView(
        model : @model
        options :
          name : "zoom"
          displayName : "Zoom"
          min : 0.01
          max : 4 #TODO @model.flycam.getMaxZoomStep()
          step : 0.001
      )

    "scale" : ->

      return new SliderSettingView(
        model : @model
        options :
          name : "scale"
          displayName : "Viewport Scale"
          min : constants.MIN_SCALE
          max : constants.MAX_SCALE
          step : 0.1
      )

    "dynamicSpaceDirection" : ->

      return new CheckboxSettingView(
        model : @model
        options :
          name : "dynamicSpaceDirection"
          displayName : "d/f-Switching"
      )


    "quality" : ->

      return new DropdownSettingView(
        model : @model
        options :
          name : "quality"
          displayName : "Quality"
          options : ["high", "medium", "low"]
      )
