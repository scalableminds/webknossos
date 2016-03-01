SettingsView        = require("./settings_view")
ColorsCategoryView  = require("../category_views/colors_category_view")
QualityCategoryView = require("../category_views/quality_category_view")

class DatasetSettingsView extends SettingsView


  id : "dataset-settings"
  className : "flex-column"

  modelName : "datasetConfiguration"


  subviewCreatorsList : [

    [
      "colors-category", ->
        return new ColorsCategoryView(model : @model)
    ]

    [
      "quality-category", ->
        return new QualityCategoryView(model : @model)
    ]
  ]

module.exports = DatasetSettingsView
