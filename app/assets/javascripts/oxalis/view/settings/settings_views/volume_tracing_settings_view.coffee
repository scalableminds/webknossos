Marionette       = require("backbone.marionette")
_                = require("lodash")
SettingsView     = require("./settings_view")
CellCategoryView = require("../category_views/cell_category_view")

class VolumeTracingSettingsView extends SettingsView


  id : "tracing-settings"
  className: "flex-column"

  modelName : "volumeTracingAdapter"


  subviewCreatorsList : [
    [
      "cell-category", ->
        return new CellCategoryView({ @model })
    ]
  ]

module.exports = VolumeTracingSettingsView
