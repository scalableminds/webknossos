SliderSettingView = require("../setting_views/slider_setting_view")
CategoryView      = require("./category_view")

class SegementationCategoryView extends CategoryView


  caption : "Segmentation"

  subviewCreatorsList : [

    [
      "segmentOpacity", ->

        return new SliderSettingView(
          model : @model
          options :
            name : "segmentationOpacity"
            displayName : "Segement Opacity"
            min : 0
            max : 100
            step : 1
        )
    ]
  ]


  initialize : ->

    super()
    @hide() unless app.oxalis.model.getSegmentationBinary()?

module.exports = SegementationCategoryView
