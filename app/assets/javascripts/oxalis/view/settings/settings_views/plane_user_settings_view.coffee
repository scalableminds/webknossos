### define
./settings_view : SettingsView
../category_views/controls_category_view : ControlsCategoryView
../category_views/viewport_category_view : ViewportCategoryView
../category_views/tdview_category_view : TDViewCategoryView
../category_views/isosurface_category_view : IsosurfaceCategoryView
../category_views/segmentation_category_view : SegmentationCategoryView
###

class PlaneUserSettingsView extends SettingsView


  id : "user-settings"


  modelName : "user"


  subviewCreators :

    "controls-category" : ->

      return new ControlsCategoryView({ @model })


    "viewport-category" : ->

      return new ViewportCategoryView({ @model })


    "tdview-category" : ->

      return new TDViewCategoryView({ @model })


    "isosurface-category" : ->

      return new IsosurfaceCategoryView({ @model })


    "segmentation-category" : ->

      return new SegmentationCategoryView({ @model })
