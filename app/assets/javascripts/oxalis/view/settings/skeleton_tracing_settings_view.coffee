### define
backbone.marionette : marionette
underscore : _
./settings_view : SettingsView
./category_views/tree_category_view : TreeCategoryView
./category_views/node_category_view : NodeCategoryView
###

class SkeletonTracingSettingsView extends SettingsView


  id : "tracing-settings"

  modelName : "skeletonTracingAdapter"

  subviewCreators :

    "tree-category" : ->

      return new TreeCategoryView({ @model })

    "node-category" : ->

      return new NodeCategoryView({ @model })
