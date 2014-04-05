### define
../setting_views/checkbox_setting_view : CheckboxSettingView
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
