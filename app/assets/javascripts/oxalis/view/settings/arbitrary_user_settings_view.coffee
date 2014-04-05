### define
backbone.marionette : marionette
underscore : _
./settings_view : SettingsView
./category_views/controls_category_view : ControlsCategoryView
./category_views/flight_category_view : FlightCategoryView
###

class ArbitraryUserSettingsView extends SettingsView


  id : "user-settings"


  subviewCreators :

    "controls-category" : ->

      return new ControlsCategoryView({ @model })

    "flight-category" : ->

      return new FlightCategoryView({ @model })
