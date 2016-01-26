Marionette          = require("backbone.marionette")
_                   = require("lodash")
SettingsView        = require("./settings_view")
TreeCategoryView    = require("../category_views/tree_category_view")
NodeCategoryView    = require("../category_views/node_category_view")
BoundingBoxCategory = require("../category_views/bounding_box_category_view")

class SkeletonTracingSettingsView extends SettingsView


  id : "tracing-settings"
  className : "flex-column"

  modelName : "skeletonTracingAdapter"

  subviewCreatorsList : [
    [
      "tree-category", ->
        return new TreeCategoryView({ @model })
    ]

    [
      "node-category", ->
        return new NodeCategoryView({ @model })
    ]

    [
      "boundingBox-category", ->
        return new BoundingBoxCategory({ @model })
    ]
  ]

module.exports = SkeletonTracingSettingsView
