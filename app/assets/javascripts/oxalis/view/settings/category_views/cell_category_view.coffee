constants         = require("oxalis/constants")
CategoryView      = require("./category_view")
NumberSettingView = require("../setting_views/number_setting_view")
ButtonSettingView = require("../setting_views/button_setting_view")

class CellCategoryView extends CategoryView


  caption : "Cells"


  subviewCreatorsList : [

    [
      "mappedActiveCellId", ->

        return new NumberSettingView(
          model : @model
          options :
            name : "mappedActiveCellId"
            displayName : "Active Cell ID"
        )
    ]

    [
      "createCell", ->

        return new ButtonSettingView(
          model : @model
          options :
            displayName : "Create new Cell"
            callbackName : "createCell"
        )
    ]
  ]

module.exports = CellCategoryView
