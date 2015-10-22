CategoryView         = require("./category_view")
TextInputSettingView = require("../setting_views/text_input_setting_view")

class BoundingBoxCategory extends CategoryView


  caption : "Bounding Box"


  subviewCreators :

    "boundingbox" : ->

      return new TextInputSettingView(
        model : @model
        options :
          name : "boundingBox"
          displayName : "Bounding Box"
          pattern : "(\\d+\\s*,\\s*){5}\\d+"
          title : "Format: minX, minY, minZ, maxX, maxY, maxZ"
      )


module.exports = BoundingBoxCategory
