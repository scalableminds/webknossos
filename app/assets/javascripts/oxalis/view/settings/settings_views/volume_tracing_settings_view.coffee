marionette       = require("backbone.marionette")
_                = require("underscore")
SettingsView     = require("./settings_view")
CellCategoryView = require("../category_views/cell_category_view")

class VolumeTracingSettingsView extends SettingsView


  id : "tracing-settings"
  className: "flex-column"

  modelName : "volumeTracingAdapter"


  subviewCreators :

    "cell-category" : ->

      return new CellCategoryView({ @model })

module.exports = VolumeTracingSettingsView
