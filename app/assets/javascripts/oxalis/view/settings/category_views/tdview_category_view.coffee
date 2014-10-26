### define
../setting_views/checkbox_setting_view : CheckboxSettingView
./category_view : CategoryView
../../../constants : constants
###

class TDViewCategoryView extends CategoryView


  caption : "3D View"


  subviewCreators :

    "displayTDViewXY" : ->

      return new CheckboxSettingView(
        model : @model
        options :
          name : "displayTDViewXY"
          displayName : "Display XY-Plane"
      )

    "displayTDViewYZ" : ->

      return new CheckboxSettingView(
        model : @model
        options :
          name : "displayTDViewYZ"
          displayName : "Display YZ-Plane"
      )

    "displayTDViewXZ" : ->

      return new CheckboxSettingView(
        model : @model
        options :
          name : "displayTDViewXZ"
          displayName : "Display XZ-Plane"
      )
