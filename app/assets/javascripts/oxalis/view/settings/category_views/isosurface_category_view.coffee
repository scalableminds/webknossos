### define
./category_view : CategoryView
../setting_views/checkbox_setting_view : CheckboxSettingView
../setting_views/slider_setting_view : SliderSettingView
oxalis/constants : constants
###

class IsosurfaceCategoryView extends CategoryView


  caption : "Isosurface View"


  subviewCreators :

    "displayIso" : ->

      return new CheckboxSettingView(
        model : @model
        options :
          name : "isosurfaceDisplay"
          displayName : "Turn On"
      )

    "boundingBox" : ->

      return new SliderSettingView(
        model : @model
        options :
          name : "isosurfaceBBsize"
          displayName : "Bounding Box Size"
          min : 1
          max : 10
          step : 0.1
      )

    "resolution" : ->

      return new SliderSettingView(
        model : @model
        options :
          name : "isosurfaceResolution"
          displayName : "Resolution"
          min : 40
          max : 400
          step : 1
      )
