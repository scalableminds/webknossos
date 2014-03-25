### define
backbone.marionette : marionette
underscore : _
./usersettings/checkbox_setting_view : CheckboxSettingView
###

class UserSettingsView extends Backbone.Marionette.CompositeView

  # TODO: remove accordion* classes after bootstrap 3 update

  template : _.template("""
    <div class="panel-group accordion" id="user-settings">

      <div class="panel panel-default accordion-group">
        <div class="panel-heading accordion-heading">
          <a class="panel-title accordion-toggle" data-toggle="collapse" data-parent="#user-settings" href="#user-settings-controls">
            Controls
          </a>
        </div>
        <div id="user-settings-controls accordion-body" class="panel-collapse collapse in">
          <div class="panel-body accordion-inner">

            <div id="view-settings"></div>

          </div>
        </div>
      </div>

      <div class="panel panel-default accordion-group">
        <div class="panel-heading accordion-heading">
          <a class="panel-title accordion-toggle" data-toggle="collapse" data-parent="#user-settings" href="#user-settings-view">
            View
          </a>
        </div>
        <div id="user-settings-view" class="panel-collapse collapse in accordion-body">
          <div class="panel-body accordion-inner">
            Hello View!
          </div>
        </div>
      </div>

    </div>
    """)


  itemViewContainer : "#view-settings"

  itemViewOptions : (item, index) ->

    return @settingViews[index].options


  initialize : ->

    @settingViews = [
      {
        view : CheckboxSettingView
        options :
          name : "inverseX"
          displayName : "Inverse X"
      }
      {
        view : CheckboxSettingView
        options :
          name : "inverseY"
          displayName : "Inverse Y"
      }
    ]

    @listenTo(@, "render", @afterRender)


  afterRender : ->

    for settingView, i in @settingViews
      @addItemView(@model, settingView.view, i)
