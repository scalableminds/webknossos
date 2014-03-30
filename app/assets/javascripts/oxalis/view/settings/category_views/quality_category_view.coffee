### define
../setting_views/checkbox_setting_view : CheckboxSettingView
../setting_views/dropdown_setting_view : DropdownSettingView
./category_view : CategoryView
../../../constants : constants
###

class QualityCategoryView extends CategoryView


  caption : "Quality"


  subviewCreators :

    "fourbit" : ->

      return new CheckboxSettingView(
        model : @model
        options :
          name : "fourbit"
          displayName : "4 Bit"
      )

    "interpolation" : ->

      return new CheckboxSettingView(
        model : @model
        options :
          name : "interpolation"
          displayName : "Interpolation"
      )

    "quality" : ->

      return new DropdownSettingView(
        model : @model
        options :
          name : "quality"
          displayName : "Quality"
          options : ["high", "medium", "low"]
      )
