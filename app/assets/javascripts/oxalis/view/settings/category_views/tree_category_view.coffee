NumberSettingView   = require("../setting_views/number_setting_view")
CheckboxSettingView = require("../setting_views/checkbox_setting_view")
CategoryView        = require("./category_view")

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

module.exports = TreeCategoryView
