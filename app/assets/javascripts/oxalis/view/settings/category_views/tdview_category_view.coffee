CheckboxSettingView = require("../setting_views/checkbox_setting_view")
CategoryView        = require("./category_view")
constants           = require("../../../constants")

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

module.exports = TDViewCategoryView
