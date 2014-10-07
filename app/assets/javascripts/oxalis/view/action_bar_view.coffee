### define
underscore : _
backbone.marionette : marionette
./settings/settings_tab_view : SettingsTabView
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

    @options = options
    @datasetPositionView = new DatasetPositionView(options)

    if @isTraceMode()
      @datasetActionsView = new DatasetActionsView(options)
      @settingsTabView = new SettingsTabView(_model : options._model)

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

    return @options.controlMode == Constants.CONTROL_MODE_TRACE


  isVolumeMode : ->

    return @options._model.mode == Constants.MODE_VOLUME

