### define
underscore : _
backbone.marionette : marionette
./action-bar/dataset_actions_view : DatasetActionsView
./action-bar/dataset_position_view : DatasetPositionView
./action-bar/view_modes_view : ViewModesView
./action-bar/volume_actions_view : VolumeActionsView
../constants : Constants
###

class ActionBarView extends Backbone.Marionette.LayoutView

  className : "container-fluid"

  template : _.template("""
    <% if (isTraceMode) { %>
      <div id="dataset-actions"></div>
    <% } %>

    <div id="dataset-position"></div>

    <% if (isVolumeMode) { %>
      <div id="volume-actions"></div>
    <% } %>

    <% if (isTraceMode) { %>
      <div id="view-modes"></div>
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


  initialize : (options) ->

    @datasetPositionView = new DatasetPositionView(options)

    if @isTraceMode()
      @datasetActionsView = new DatasetActionsView(options)

      if @isVolumeMode()
        @volumeActionsView = new VolumeActionsView(options)
      else
        @viewModesView = new ViewModesView(options)


    @listenTo(@, "render", @afterRender)


  afterRender : ->

    @datasetPosition.show(@datasetPositionView)

    if @isTraceMode()
      @datasetActionButtons.show(@datasetActionsView)

      if @isVolumeMode()
        @volumeActions.show(@volumeActionsView)
      else
        @viewModes.show(@viewModesView)


  isTraceMode : ->

    return @model.get("controlMode") == Constants.CONTROL_MODE_TRACE


  isVolumeMode : ->

    return @model.get("mode") == Constants.MODE_VOLUME

