### define
underscore : _
backbone.marionette : marionette
./settings/skeleton_tracing_settings_view : SkeletonTracingSettingsView
./settings/volume_tracing_settings_view : VolumeTracingSettingsView
./settings/plane_user_settings_view : PlaneUserSettingsView
./settings/arbitrary_user_settings_view : ArbitraryUserSettingsView
./settings/dataset_settings_view : DatasetSettingsView
./left-menu/dataset_actions_view : DatasetActionsView
./left-menu/dataset_info_view : DatasetInfoView
./left-menu/dataset_position_view : DatasetPositionView
./left-menu/view_modes_view : ViewModesView
../constants : constants
###

class LeftMenuView extends Backbone.Marionette.Layout

  className : "container-fluid"

  template : _.template("""
    <% if (isNotViewMode()) { %>
      <div id="dataset-actions" class="row"></div>
    <% } %>

    <div id="dataset-info" class="row"></div>

    <div id="dataset-position" class="row"></div>

    <% if (isNotViewMode()) { %>
      <div id="volume-actions" class="volume-controls">
        <button class="btn btn-default" id="btn-merge">Merge cells</button>
      </div>
    <% } %>

    <% if (isNotViewMode()) { %>
      <div id="view-modes" class="row"></div>
    <% } %>

    <% if (isNotViewMode()) { %>
      <div class="row">
        <div id="lefttabbar" class="col-sm-12">
          <ul class="nav nav-tabs">
            <li class="active">
              <a href="#tracing-settings-tab" data-toggle="tab"><i class="fa fa-cogs"></i> Tracing</a>
            </li>
            <li>
              <a href="#dataset-settings-tab" data-toggle="tab"><i class="fa fa-cogs"></i> Dataset</a>
            </li>
            <li>
              <a href="#user-settings-tab" data-toggle="tab"><i class="fa fa-cogs"></i> User</a>
            </li>
          </ul>

          <div class="tab-content">
            <div class="tab-pane active" id="tracing-settings-tab"></div>
            <div class="tab-pane" id="dataset-settings-tab"></div>
            <div class="tab-pane" id="user-settings-tab"></div>
          </div>
        </div>
      </div>
    <% } %>
  """)

  templateHelpers :
    # spotlight aka public viewing
    isViewMode : ->
      return @controlMode == constants.CONTROL_MODE_VIEW
    isNotViewMode : ->
      return not @isViewMode()


  regions :
    "datasetActionButtons" : "#dataset-actions"
    "datasetInfo" : "#dataset-info"
    "datasetPosition" : "#dataset-position"
    "tracingSettings" : "#tracing-settings-tab"
    "userSettings" : "#user-settings-tab"
    "datasetSettings" : "#dataset-settings-tab"
    "viewModes" : "#view-modes"


  initialize : (options) ->

    @options = options
    @datasetActionsView = new DatasetActionsView(options)
    @datasetInfoView = new DatasetInfoView(options)
    @datasetPositionView = new DatasetPositionView(options)
    @viewModesView = new ViewModesView(options)

    @skeletonTracingSettingsView = new SkeletonTracingSettingsView(_model : options._model)
    @volumeTracingSettingsView = new VolumeTracingSettingsView(_model : options._model)

    @planeUserSettingsView = new PlaneUserSettingsView(_model : options._model)
    @arbitraryUserSettingsView = new ArbitraryUserSettingsView(_model : options._model)

    @datasetSettingsView = new DatasetSettingsView(_model : options._model)

    @listenTo(@, "render", @afterRender)
    @listenTo(app.vent, "changeViewMode", @changeViewMode)


  afterRender : ->

    @datasetActionButtons.show(@datasetActionsView)
    @datasetInfo.show(@datasetInfoView)
    @datasetPosition.show(@datasetPositionView)
    @viewModes.show(@viewModesView)

    @datasetSettings.show(@datasetSettingsView)


  changeViewMode : (mode) ->

    if mode == constants.MODE_PLANE_TRACING
      @userSettings.show(@planeUserSettingsView)
      @tracingSettings.show(@skeletonTracingSettingsView)
    else if mode in constants.MODES_ARBITRARY
      @userSettings.show(@arbitraryUserSettingsView)
      @tracingSettings.show(@skeletonTracingSettingsView)
    else if mode == constants.MODE_VOLUME
      @userSettings.show(@planeUserSettingsView)
      @tracingSettings.show(@volumeTracingSettingsView)


  serializeData : ->

    return @options


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
