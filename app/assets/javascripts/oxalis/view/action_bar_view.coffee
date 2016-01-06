_                   = require("lodash")
marionette          = require("backbone.marionette")
DatasetActionsView  = require("./action-bar/dataset_actions_view")
DatasetPositionView = require("./action-bar/dataset_position_view")
ViewModesView       = require("./action-bar/view_modes_view")
VolumeActionsView   = require("./action-bar/volume_actions_view")
SkeletonActionsView = require("./action-bar/skeleton_actions_view")
Constants           = require("../constants")

class ActionBarView extends Backbone.Marionette.LayoutView

  className : "container-fluid"

  template : _.template("""

    <% if (isTraceMode) { %>
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

    <div id="dataset-position"></div>

    <% if (isVolumeMode) { %>
      <div id="volume-actions"></div>
    <% } %>

    <% if (isTraceMode) { %>
      <div id="view-modes"></div>
      <div id="skeleton-actions"></div>
    <% } %>
  """)

  templateHelpers : ->

    isTraceMode : @isTraceMode()
    isVolumeMode : @isVolumeMode()


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

    @datasetPosition.show(@datasetPositionView)

    if @isTraceMode()
      @datasetActionButtons.show(@datasetActionsView)

      if @isVolumeMode()
        @volumeActions.show(@volumeActionsView)
      else
        @viewModes.show(@viewModesView)
        @skeletonActions.show(@skeletonActionsView)


  isTraceMode : ->

    return @model.get("controlMode") == Constants.CONTROL_MODE_TRACE


  isVolumeMode : ->

    return @model.get("mode") == Constants.MODE_VOLUME


module.exports = ActionBarView
