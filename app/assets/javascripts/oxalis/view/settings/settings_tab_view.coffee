### define
underscore : _
backbone.marionette : marionette
./skeleton_tracing_settings_view : SkeletonTracingSettingsView
./volume_tracing_settings_view : VolumeTracingSettingsView
./plane_user_settings_view : PlaneUserSettingsView
./arbitrary_user_settings_view : ArbitraryUserSettingsView
./dataset_settings_view : DatasetSettingsView
oxalis/constants : constants
oxalis/model/settings/backbone_to_oxalis_adapter_model : BackboneToOxalisAdapterModel
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
  </div>
  """)

  regions :
    "tracingSettings" : "#tracing-settings-tab"
    "userSettings" : "#user-settings-tab"
    "datasetSettings" : "#dataset-settings-tab"


  initialize : (options) ->

    backboneToOxalisAdapter = new BackboneToOxalisAdapterModel(options)
    @skeletonTracingSettingsView = new SkeletonTracingSettingsView(model : backboneToOxalisAdapter)
    @volumeTracingSettingsView = new VolumeTracingSettingsView(model : backboneToOxalisAdapter)

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
