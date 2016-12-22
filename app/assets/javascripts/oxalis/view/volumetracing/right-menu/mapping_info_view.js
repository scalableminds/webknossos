backbone            = require("backbone")
Marionette          = require("backbone.marionette")
subviews            = require("backbone-subviews")
_                   = require("lodash")
CheckboxSettingView = require("oxalis/view/settings/setting_views/checkbox_setting_view")

class MappingInfoView extends Marionette.View

  RENDER_DEBOUNCE_TIME : 200

  id : "volume-mapping-info"
  template : _.template("""
    <div class="well">
      <% if (hasMapping) { %>
        <p>ID without mapping: <%- idWithoutMapping %></p>
        <p>ID with mapping: <%- idWithMapping %></p>
      <% } else { %>
        <p>ID at current position: <%- idWithoutMapping %></p>
      <% } %>
    </div>
    <% if (hasMapping) { %>
      <div data-subview="enableMapping"></div>
    <% } %>
    """)


  subviewCreators :

    "enableMapping" : ->

      return new CheckboxSettingView(
        model : @model
        options :
          name : "enableMapping"
          displayName : "Enable Mapping"
      )


  initialize : ({model : oxalisModel}) ->

    Backbone.Subviews.add(this)

    @model = new Backbone.Model()
    @model.set("enableMapping", true)

    @binary = oxalisModel.getSegmentationBinary()
    @cube = @binary.cube
    @flycam = oxalisModel.flycam

    @renderDebounced = _.debounce(@render, @RENDER_DEBOUNCE_TIME)
    @listenTo(@cube, "bucketLoaded", @renderDebounced)
    @listenTo(@cube, "volumeLabeled", @renderDebounced)
    @listenTo(@cube, "newMapping", @render)
    @listenTo(@flycam, "positionChanged", @renderDebounced)
    @listenTo(@model, "change:enableMapping", ->
      @cube.setMappingEnabled(@model.get("enableMapping"))
    )


  serializeData : ->

    pos = @flycam.getPosition()

    return {
      hasMapping : @cube.hasMapping()
      idWithMapping : @cube.getDataValue(pos, @cube.mapping)
      idWithoutMapping : @cube.getDataValue(pos, @cube.EMPTY_MAPPING)
    }

module.exports = MappingInfoView
