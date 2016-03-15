CategoryView         = require("./category_view")
TextInputSettingView = require("../setting_views/text_input_setting_view")
Utils                = require("libs/utils")
Toast                = require("libs/toast")

class BoundingBoxCategory extends CategoryView


  caption : "Bounding Box"


  subviewCreatorsList : [

    [
      "boundingbox", ->

        return new TextInputSettingView(
          model : @model
          options :
            name : "boundingBox"
            displayName : "Bounding Box"
            pattern : "(\\d+\\s*,\\s*){5}\\d+"
            title : "Format: minX, minY, minZ, maxX, maxY, maxZ"
            validate : @validate
        )
    ]
  ]

  validate : (value)->

    [minX, minY, minZ, maxX, maxY, maxZ] = Utils.stringToNumberArray(value)

    if isValid = minX > maxX or minY > maxY or minZ > maxZ

      # Unfortunately we cannot use HTML5 form validation here since the text box
      # is not part of a form and a submit event is missing :-(
      Toast.error("Bounding Box: Max value must be bigger than min value.", false)

      # Set input as invalid for CSS highlighting
      @ui.text[0].setCustomValidity("Max value must be bigger than min value.")
    else
      # reset error state
      @ui.text[0].setCustomValidity("")

    return isValid

module.exports = BoundingBoxCategory
