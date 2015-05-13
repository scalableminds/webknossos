### define
../setting_views/checkbox_setting_view : CheckboxSettingView
./category_view : CategoryView
###

class AbstractTreeCategoryView extends CategoryView

  caption : "Abstract Tree"

  subviewCreators :

    "renderComments" : ->

      return new CheckboxSettingView(
        model : @model
        options :
          name : "renderComments"
          displayName : "Render Comments"
      )
