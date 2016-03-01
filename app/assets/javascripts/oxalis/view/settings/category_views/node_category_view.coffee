NumberSettingView   = require("../setting_views/number_setting_view")
CheckboxSettingView = require("../setting_views/checkbox_setting_view")
SliderSettingView   = require("../setting_views/slider_setting_view")
ButtonSettingView   = require("../setting_views/button_setting_view")
CategoryView        = require("./category_view")
Constants           = require("oxalis/constants")

class NodeCategoryView extends CategoryView


  caption : "Nodes"

  subviewCreatorsList : [

    [
      "activeNode", ->

        return new NumberSettingView(
          model : @model
          options :
            name : "activeNodeId"
            displayName : "Active Node ID"
        )
    ]

    [
      "radius", ->

        return new SliderSettingView(
          model : @model
          options :
            name : "radius"
            displayName : "Radius"
            min : 1
            max : 5000
            step : 1
        )
    ]

    [
      "particleSize", ->

        return new SliderSettingView(
          model : @model
          options :
            name : "particleSize"
            displayName : "Particle Size"
            min : Constants.MIN_PARTICLE_SIZE
            max : Constants.MAX_PARTICLE_SIZE
            step : 0.1
        )
    ]

    [
      "overrideNodeRadius", ->

        return new CheckboxSettingView(
          model : @model
          options :
            name : "overrideNodeRadius"
            displayName : "Override Radius"
        )
    ]

    [
      "deleteActiveNode", ->

        return new ButtonSettingView(
          model : @model
          options :
            displayName : "Delete Active Node"
            callbackName : "deleteActiveNode"
        )
    ]
  ]


module.exports = NodeCategoryView
