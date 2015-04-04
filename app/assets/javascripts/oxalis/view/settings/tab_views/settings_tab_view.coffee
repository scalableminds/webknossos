### define
underscore : _
backbone.marionette : marionette
../settings_views/skeleton_tracing_settings_view : SkeletonTracingSettingsView
../settings_views/volume_tracing_settings_view : VolumeTracingSettingsView
../settings_views/plane_user_settings_view : PlaneUserSettingsView
../settings_views/arbitrary_user_settings_view : ArbitraryUserSettingsView
../settings_views/dataset_settings_view : DatasetSettingsView
oxalis/constants : constants
###

class SettingsTabView extends Backbone.Marionette.LayoutView

  template : _.template("""
    <ul class="nav nav-tabs">
      <li>
        <a href="#tracing-settings-tab" data-toggle="tab"><i class="fa fa-cogs"></i> Tracing</a>
      </li>
      <li  class="active">
        <a href="#dataset-settings-tab" data-toggle="tab"><i class="fa fa-cogs"></i> Dataset</a>
      </li>
      <li>
        <a href="#user-settings-tab" data-toggle="tab"><i class="fa fa-cogs"></i> User</a>
      </li>
    </ul>

    <div class="tab-content">
      <div class="tab-pane" id="tracing-settings-tab"></div>
      <div class="tab-pane active" id="dataset-settings-tab"></div>
      <div class="tab-pane" id="user-settings-tab"></div>
    </div>
  """)

  regions :
    "tracingSettings" : "#tracing-settings-tab"
    "userSettings" : "#user-settings-tab"
    "datasetSettings" : "#dataset-settings-tab"


  initialize : (options) ->

    @skeletonTracingSettingsView = new SkeletonTracingSettingsView(options)
    @volumeTracingSettingsView = new VolumeTracingSettingsView(options)

    @planeUserSettingsView = new PlaneUserSettingsView(options)
    @arbitraryUserSettingsView = new ArbitraryUserSettingsView(options)

    @datasetSettingsView = new DatasetSettingsView(options)

    @listenTo(@, "render", @afterRender)


  afterRender : ->

    @datasetSettings.show(@datasetSettingsView)
    @listenTo(app.vent, "changeViewMode", @changeViewMode)


  changeViewMode : (mode) ->

    if mode == constants.MODE_PLANE_TRACING
      @userSettings.show(@planeUserSettingsView, preventDestroy : true)
      @tracingSettings.show(@skeletonTracingSettingsView, preventDestroy : true)
    else if mode in constants.MODES_ARBITRARY
      @userSettings.show(@arbitraryUserSettingsView, preventDestroy : true)
      @tracingSettings.show(@skeletonTracingSettingsView, preventDestroy : true)
    else if mode == constants.MODE_VOLUME
      @userSettings.show(@planeUserSettingsView, preventDestroy : true)
      @tracingSettings.show(@volumeTracingSettingsView, preventDestroy : true)
