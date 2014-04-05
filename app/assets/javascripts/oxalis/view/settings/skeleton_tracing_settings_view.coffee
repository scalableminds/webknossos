### define
backbone.marionette : marionette
underscore : _
./settings_view : SettingsView
./category_views/controls_category_view : TreeCategoryView
./category_views/flight_category_view : NodeCategoryView
###

class SkeletonTracingSettingsView extends SettingsView


  id : "tracing-settings"


  subviewCreators :

    "tree-category" : ->

      return new TreeCategoryView({ @model })

    "node-category" : ->

      return new NodeCategoryView({ @model })
