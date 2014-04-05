### define
./settings_view : SettingsView
./category_views/controls_category_view : ControlsCategoryView
./category_views/viewport_category_view : ViewportCategoryView
./category_views/tdview_category_view : TDViewCategoryView
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
