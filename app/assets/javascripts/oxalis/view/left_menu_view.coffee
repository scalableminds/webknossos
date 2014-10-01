### define
underscore : _
backbone.marionette : marionette
./settings/settings_tab_view : SettingsTabView
./left-menu/dataset_actions_view : DatasetActionsView
./left-menu/dataset_info_view : DatasetInfoView
./left-menu/dataset_position_view : DatasetPositionView
./left-menu/view_modes_view : ViewModesView
./left-menu/help_logo_view : HelpLogoView
./left-menu/segmentation_info_view : SegmentationInfoView
./left-menu/volume_actions_view : VolumeActionsView
../constants : Constants
###

class LeftMenuView extends Backbone.Marionette.LayoutView

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

    <% if (isViewMode) { %>
      <div id="segmentation-info" class="row"></div>
      <div id="help-logo" class="row"></div>
    <% } %>

    <% if (isTraceMode) { %>
      <div id="settings-tab" class="row"></div>
    <% } %>
  """)

  templateHelpers : ->

    isTraceMode : @isTraceMode()
    isViewMode : @isViewMode # spotlight aka public viewing
    isVolumeMode : @isVolumeMode()


  regions :
    "datasetActionButtons" : "#dataset-actions"
    "datasetInfo" : "#dataset-info"
    "datasetPosition" : "#dataset-position"
    "settingsTab" : "#settings-tab"
    "viewModes" : "#view-modes"
    "helpLogo" : "#help-logo"
    "segmentationInfo" : "#segmentation-info"
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


    else if @isViewMode()
      @helpLogoView = new HelpLogoView()
      @segmentationInfoView = new SegmentationInfoView(options)

    @listenTo(@, "render", @afterRender)


  afterRender : ->

    @datasetInfo.show(@datasetInfoView)
    @datasetPosition.show(@datasetPositionView)

    if @isTraceMode()
      @datasetActionButtons.show(@datasetActionsView)
      @settingsTab.show(@settingsTabView)

      if @isVolumeMode()
        @volumeActions.show(@volumeActionsView)
      else
        @viewModes.show(@viewModesView)


    else if @isViewMode()
      @helpLogo.show(@helpLogoView)
      @segmentationInfo.show(@segmentationInfoView)


  isTraceMode : ->

    return @options.controlMode == Constants.CONTROL_MODE_TRACE


  isViewMode : ->

    return not @isTraceMode()


  isVolumeMode : ->

    return @options._model.mode == Constants.MODE_VOLUME

