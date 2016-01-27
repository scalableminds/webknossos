SettingsView             = require("./settings_view")
ControlsCategoryView     = require("../category_views/controls_category_view")
ViewportCategoryView     = require("../category_views/viewport_category_view")
TDViewCategoryView       = require("../category_views/tdview_category_view")
IsosurfaceCategoryView   = require("../category_views/isosurface_category_view")
SegmentationCategoryView = require("../category_views/segmentation_category_view")
AbstractTreeCategoryView = require("../category_views/abstracttree_category_view")

class PlaneUserSettingsView extends SettingsView


  id : "user-settings"
  className : "flex-column"

  modelName : ["user", "flycam"]


  subviewCreatorsList : [
    [
      "controls-category", ->
        return new ControlsCategoryView({ model : @model.user })
    ]

    [
      "viewport-category", ->
        return new ViewportCategoryView({ @model })
    ]

    [
      "tdview-category", ->
        return new TDViewCategoryView({ model : @model.user })
    ]

    [
      "isosurface-category", ->
        return new IsosurfaceCategoryView({ model : @model.user })
    ]

    [
      "segmentation-category", ->
        return new SegmentationCategoryView({ model : @model.user })
    ]

    [
      "abstracttree-category", ->
        return new AbstractTreeCategoryView({ model : @model.user })
    ]
  ]

module.exports = PlaneUserSettingsView
