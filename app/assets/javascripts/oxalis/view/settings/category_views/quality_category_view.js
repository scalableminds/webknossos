CheckboxSettingView = require("../setting_views/checkbox_setting_view")
DropdownSettingView = require("../setting_views/dropdown_setting_view")
CategoryView        = require("./category_view")
constants           = require("../../../constants")

class QualityCategoryView extends CategoryView


  caption : "Quality"


  subviewCreatorsList : [

    [
      "fourBit", ->

        return new CheckboxSettingView(
          model : @model
          options :
            name : "fourBit"
            displayName : "4 Bit"
        )
    ]

    [
      "interpolation", ->

        return new CheckboxSettingView(
          model : @model
          options :
            name : "interpolation"
            displayName : "Interpolation"
        )
    ]

    [
      "quality", ->

        return new DropdownSettingView(
          model : @model
          options :
            name : "quality"
            displayName : "Quality"
            options : ["high", "medium", "low"]
        )
    ]
  ]

module.exports = QualityCategoryView
