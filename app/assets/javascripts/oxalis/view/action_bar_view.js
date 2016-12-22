_                   = require("lodash")
Marionette          = require("backbone.marionette")
DatasetActionsView  = require("./action-bar/dataset_actions_view")
DatasetPositionView = require("./action-bar/dataset_position_view")
ViewModesView       = require("./action-bar/view_modes_view")
VolumeActionsView   = require("./action-bar/volume_actions_view")
SkeletonActionsView = require("./action-bar/skeleton_actions_view")
Constants           = require("../constants")

class ActionBarView extends Marionette.View

  className : "container-fluid"

  template : _.template("""

    <% if (isTraceMode && hasAdvancedOptions) { %>
      <a href="#" id="menu-toggle-button" class="btn btn-default"
        data-toggle="offcanvas"
        data-target="#settings-menu-wrapper"
        data-canvas="#sliding-canvas"
        data-placement="left"
        data-autohide="false"
        data-disable-scrolling="false"><i class="fa fa-bars"></i>Menu</a>
    <% } %>

    <% if (isTraceMode) { %>
      <div id="dataset-actions"></div>
    <% } %>

    <% if (hasAdvancedOptions) { %>
      <div id="dataset-position"></div>
    <% } %>

    <% if (isVolumeMode && hasAdvancedOptions) { %>
      <div id="volume-actions"></div>
    <% } %>

    <% if (isTraceMode && hasAdvancedOptions) { %>
      <div id="view-modes"></div>
      <div id="skeleton-actions"></div>
    <% } %>
  """)

  templateContext : ->

    isTraceMode : @isTraceMode()
    isVolumeMode : @isVolumeMode()
    hasAdvancedOptions : @hasAdvancedOptions()


  regions :
    "datasetActionButtons" : "#dataset-actions"
    "datasetPosition" : "#dataset-position"
    "viewModes" : "#view-modes"
    "volumeActions" : "#volume-actions"
    "skeletonActions" : "#skeleton-actions"


  initialize : (options) ->

    @datasetPositionView = new DatasetPositionView(options)

    if @isTraceMode()
      @datasetActionsView = new DatasetActionsView(options)

      if @isVolumeMode()
        @volumeActionsView = new VolumeActionsView(options)
      else
        @viewModesView = new ViewModesView(options)
        @skeletonActionsView = new SkeletonActionsView(options)


    @listenTo(@, "render", @afterRender)


  afterRender : ->

    if @hasAdvancedOptions()
      @showChildView("datasetPosition", @datasetPositionView)

    if @isTraceMode()
      @showChildView("datasetActionButtons", @datasetActionsView)

      if @hasAdvancedOptions()
        if @isVolumeMode()
          @showChildView("volumeActions", @volumeActionsView)
        else
          @showChildView("viewModes", @viewModesView)
          @showChildView("skeletonActions", @skeletonActionsView)


  isTraceMode : ->

    return @model.get("controlMode") == Constants.CONTROL_MODE_TRACE


  isVolumeMode : ->

    return @model.get("mode") == Constants.MODE_VOLUME


  hasAdvancedOptions : ->

    return @model.settings.advancedOptionsAllowed


module.exports = ActionBarView
