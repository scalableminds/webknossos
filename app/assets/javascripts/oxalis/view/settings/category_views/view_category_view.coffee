### define
app : app
../setting_views/checkbox_setting_view : CheckboxSettingView
../setting_views/slider_setting_view : SliderSettingView
./category_view : CategoryView
###

class ViewCategoryView extends CategoryView


  caption : "View"


  subviewCreators :

    "displayCrosshair" : ->

      return new CheckboxSettingView(
        model : @model
        options :
          name : "displayCrosshair"
          displayName : "Show Crosshairs"
      )

    "clippingDistance" : ->

      return new SliderSettingView(
        model : @model
        options :
          name : "clippingDistance"
          displayName : "Clipping Distance"
          min : 1
          max : 1000 * app.scaleInfo.baseVoxel
          step : 1
      )
