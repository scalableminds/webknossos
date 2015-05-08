### define
backbone.marionette : marionette
underscore : _
./settings_view : SettingsView
../category_views/cell_category_view : CellCategoryView
###

class VolumeTracingSettingsView extends SettingsView


  id : "tracing-settings"
  className: "flex-column"

  modelName : "volumeTracingAdapter"


  subviewCreators :

    "cell-category" : ->

      return new CellCategoryView({ @model })
