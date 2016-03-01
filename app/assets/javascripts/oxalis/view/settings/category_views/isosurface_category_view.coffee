CategoryView        = require("./category_view")
CheckboxSettingView = require("../setting_views/checkbox_setting_view")
SliderSettingView   = require("../setting_views/slider_setting_view")
constants           = require("oxalis/constants")
app                 = require("app")

class IsosurfaceCategoryView extends CategoryView


  caption : "Isosurface View"


  subviewCreatorsList : [

    [
      "displayIso", ->

        return new CheckboxSettingView(
          model : @model
          options :
            name : "isosurfaceDisplay"
            displayName : "Turn On"
        )
    ]

    [
      "boundingBox", ->

        return new SliderSettingView(
          model : @model
          options :
            name : "isosurfaceBBsize"
            displayName : "Bounding Box Size"
            min : 1
            max : 10
            step : 0.1
        )
    ]

    [
      "resolution", ->

        return new SliderSettingView(
          model : @model
          options :
            name : "isosurfaceResolution"
            displayName : "Resolution"
            min : 40
            max : 400
            step : 1
        )
    ]
  ]


  initialize : ->

    super()
    @hide() unless app.oxalis.model.volumeTracing?

module.exports = IsosurfaceCategoryView
