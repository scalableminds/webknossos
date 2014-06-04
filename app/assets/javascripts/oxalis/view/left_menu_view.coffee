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
../constants : constants
###

class LeftMenuView extends Backbone.Marionette.Layout

  className : "container-fluid"

  template : _.template("""
    <% if (isTraceMode) { %>
      <div id="dataset-actions" class="row"></div>
    <% } %>

    <div id="dataset-info" class="row"></div>

    <div id="dataset-position" class="row"></div>

    <% if (!isTraceMode && !isViewMode) { %>
      <div id="volume-actions" class="volume-controls">
        <button class="btn btn-default" id="btn-merge">Merge cells</button>
      </div>
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


  regions :
    "datasetActionButtons" : "#dataset-actions"
    "datasetInfo" : "#dataset-info"
    "datasetPosition" : "#dataset-position"
    "settingsTab" : "#settings-tab"
    "viewModes" : "#view-modes"
    "helpLogo" : "#help-logo"
    "segmentationInfo" : "#segmentation-info"


  initialize : (options) ->

    @options = options
    @datasetInfoView = new DatasetInfoView(options)
    @datasetPositionView = new DatasetPositionView(options)

    if @isTraceMode()
      @datasetActionsView = new DatasetActionsView(options)
      @viewModesView = new ViewModesView(options)
      @settingsTabView = new SettingsTabView(_model : options._model)

    else if @isViewMode()
      @helpLogoView = new HelpLogoView()
      @segmentationInfoView = new SegmentationInfoView(options)

    @listenTo(@, "render", @afterRender)


  afterRender : ->

    @datasetInfo.show(@datasetInfoView)
    @datasetPosition.show(@datasetPositionView)

    if @isTraceMode()
      @datasetActionButtons.show(@datasetActionsView)
      @viewModes.show(@viewModesView)

      @settingsTab.show(@settingsTabView)

    else if @isViewMode()
      @helpLogo.show(@helpLogoView)
      @segmentationInfo.show(@segmentationInfoView)


  isTraceMode : ->

    return @options.controlMode == constants.CONTROL_MODE_TRACE


  isViewMode : ->

    return not @isTraceMode()


  #   <% if(task) { %>
  #     <li><a href="#tab0" data-toggle="tab">Task</a></li>
  #   <% } %>
  #   @if(additionalHtml.body != ""){
  #     <li class="active"><a href="#tab1" data-toggle="tab">Review</a></li>
  #     <li>
  #   } else {
  #     <li class="active">
  #   }
  #   <a href="#tab2" data-toggle="tab">Options</a></li>
  # </ul>
  #
  # <div class="tab-content">
  #   <% if(task) { %>
  #     <div class="tab-pane" id="tab0">
  #       <h5><%=task.type.summary%></h5>
  #       <%=task.type.description%>
  #     </div>
  #   <% } %>
