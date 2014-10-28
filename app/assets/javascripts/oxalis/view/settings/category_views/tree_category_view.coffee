### define
../setting_views/number_setting_view : NumberSettingView
../setting_views/checkbox_setting_view : CheckboxSettingView
./category_view : CategoryView
###

class TreeCategoryView extends CategoryView


  caption : "Trees"

  subviewCreators :

    "activeTree" : ->

      return new NumberSettingView(
        model : @model
        options :
          name : "activeTreeId"
          displayName : "Active Tree ID"
      )

    "somaClicking" : ->

      return new CheckboxSettingView(
        model : @model
        options :
          name : "somaClicking"
          displayName : "Soma Clicking"
      )
