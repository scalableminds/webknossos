### define
../setting_views/checkbox_setting_view : CheckboxSettingView
./category_view : CategoryView
../../../constants : constants
###

class TDViewCategoryView extends CategoryView


  caption : "3D View"


  subviewCreators :

    "tdViewDisplayPlanes" : ->

      return new CheckboxSettingView(
        model : @model
        options :
          name : "tdViewDisplayPlanes"
          displayName : "Display Planes"
      )
