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
            title : "Format: minX, minY, minZ, width, height, depth"
            validate : @validate
        )
    ]
  ]

  validate : (value)->

    [minX, minY, minZ, width, height, depth] = Utils.stringToNumberArray(value)

    # Width, height and depth of 0 should be allowed as a non-existing bounding box equals 0,0,0,0,0,0
    if isInvalid = width < 0 or height < 0 or depth < 0

      # Unfortunately we cannot use HTML5 form validation here since the text box
      # is not part of a form and a submit event is missing :-(
      Toast.error("Bounding Box: Width, height and depth must be >= 0.", false)

      # Set input as invalid for CSS highlighting
      @ui.text[0].setCustomValidity("Width, height and depth must be >= 0.")
    else
      # reset error state
      @ui.text[0].setCustomValidity("")

    return not isInvalid

module.exports = BoundingBoxCategory
