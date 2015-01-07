### define
../setting_views/slider_setting_view : SliderSettingView
./category_view : CategoryView
###

class SegementationCategoryView extends CategoryView


  caption : "Segmentation"

  subviewCreators :

    "segmentOpacity" : ->

      return new SliderSettingView(
        model : @model
        options :
          name : "segmentationOpacity"
          displayName : "Segement Opacity"
          min : 0
          max : 100
          step : 1
      )


  initialize : ->

    super()
    @hide() unless app.oxalis.model.getSegmentationBinary()?
