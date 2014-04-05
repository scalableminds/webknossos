### define
backbone.marionette : marionette
underscore : _
./settings_view : SettingsView
./category_views/controls_category_view : CellCategoryView
###

class VolumeTracingSettingsView extends SettingsView


  id : "tracing-settings"


  subviewCreators :

    "cell-category" : ->

      return new CellCategoryView({ @model })
