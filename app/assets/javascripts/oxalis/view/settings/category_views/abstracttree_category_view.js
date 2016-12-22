CheckboxSettingView = require("../setting_views/checkbox_setting_view")
CategoryView        = require("./category_view")

class AbstractTreeCategoryView extends CategoryView

  caption : "Abstract Tree"

  subviewCreatorsList : [

    [
      "renderComments", ->

        return new CheckboxSettingView(
          model : @model
          options :
            name : "renderComments"
            displayName : "Render Comments"
        )
    ]
  ]

module.exports = AbstractTreeCategoryView
