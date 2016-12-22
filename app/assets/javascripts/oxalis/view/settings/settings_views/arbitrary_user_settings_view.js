SettingsView         = require("./settings_view")
ControlsCategoryView = require("../category_views/controls_category_view")
FlightCategoryView   = require("../category_views/flight_category_view")

class ArbitraryUserSettingsView extends SettingsView


  id : "user-settings"
  className : "flex-column"


  modelName : "user"


  subviewCreatorsList : [
    [
      "controls-category", ->

        return new ControlsCategoryView(model : @model)
    ]

    [
      "flight-category", ->

        return new FlightCategoryView(model : @model)
    ]
  ]

module.exports = ArbitraryUserSettingsView
