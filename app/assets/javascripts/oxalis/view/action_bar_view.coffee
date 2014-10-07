### define
underscore : _
backbone.marionette : marionette
./settings/settings_tab_view : SettingsTabView
./left-menu/dataset_actions_view : DatasetActionsView
./left-menu/dataset_info_view : DatasetInfoView
./left-menu/dataset_position_view : DatasetPositionView
./left-menu/view_modes_view : ViewModesView
./left-menu/volume_actions_view : VolumeActionsView
../constants : Constants
###

class ActionBarView extends Backbone.Marionette.LayoutView

  className : "container-fluid"

  template : _.template("""
    <% if (isTraceMode) { %>
      <div id="dataset-actions" class="row"></div>
    <% } %>

    <div id="dataset-info" class="row"></div>
    <div id="dataset-position" class="row"></div>

    <% if (isVolumeMode) { %>
      <div id="volume-actions"></div>
    <% } %>

    <% if (isTraceMode) { %>
      <div id="view-modes" class="row"></div>
    <% } %>
  """)

  templateHelpers : ->

    isTraceMode : @isTraceMode()
    isVolumeMode : @isVolumeMode()


  regions :
    "datasetActionButtons" : "#dataset-actions"
    "datasetInfo" : "#dataset-info"
    "datasetPosition" : "#dataset-position"
    "viewModes" : "#view-modes"
    "volumeActions" : "#volume-actions"


  initialize : (options) ->

    @options = options
    @datasetInfoView = new DatasetInfoView(options)
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

    @datasetInfo.show(@datasetInfoView)
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

