### define
underscore : _
backbone.marionette : marionette
./settings/user_settings_view : UserSettingsView
./settings/dataset_settings_view : DatasetSettingsView
./left-menu/dataset_actions_view : DatasetActionsView
./left-menu/dataset_info_view : DatasetInfoView
./left-menu/dataset_position_view : DatasetPositionView
###

class LeftMenuView extends Backbone.Marionette.Layout

  template : _.template("""
    <div id="dataset-actions"></div

    <div id="dataset-info"></div>

    <div id="dataset-position"></div>


    <div id="volume-actions" class="volume-controls">
      <button class="btn btn-default" id="btn-merge">Merge cells</button>
    </div>

    <div id="view-mode" class="skeleton-controls">
      <p>View mode:</p>
      <div class="btn-group">
        <button type="button" class="btn btn-default btn-primary" id="view-mode-3planes">3 Planes</button>
        <button type="button" class="btn btn-default" id="view-mode-sphere">Sphere</button>
        <button type="button" class="btn btn-default" id="view-mode-arbitraryplane">Arbitrary Plane</button>
      </div>
    </div>

    <div id="lefttabbar">
        <ul class="nav nav-tabs">
          <li class="active">
          <a href="#dataset-settings-tab" data-toggle="tab"><i class="fa fa-cogs"></i> Dataset</a></li>
          <li>
          <a href="#user-settings-tab" data-toggle="tab"><i class="fa fa-cogs"></i> User</a></li>
        </ul>

        <div class="tab-content">
          <div class="tab-pane active" id="dataset-settings-tab"></div>
          <div class="tab-pane" id="user-settings-tab"></div>
        </div>

    </div>
  """)

  regions :
    "datasetActionButtons" : "#dataset-actions"
    "datasetInfo" : "#dataset-info"
    "datasetPosition" : "#dataset-position"
    "userSettings" : "#user-settings-tab"
    "datasetSettings" : "#dataset-settings-tab"

  initialize : (options) ->

    @datasetActionsView = new DatasetActionsView(options)
    @datasetInfoView = new DatasetInfoView(options)
    @datasetPositionView = new DatasetPositionView(options)

    @userSettingsView = new UserSettingsView(_model : options._model)
    @datasetSettingsView = new DatasetSettingsView(_model : options._model)

    @listenTo(@, "render", @afterRender)


  afterRender : ->

    @userSettings.show(@userSettingsView)
    @datasetSettings.show(@datasetSettingsView)

    @datasetActionButtons.show(@datasetActionsView)
    @datasetInfo.show(@datasetInfoView)
    @datasetPosition.show(@datasetPositionView)


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
