### define
backbone.marionette : marionette
backbone.subviews : subviews
underscore : _
../settingviews/checkbox_setting_view : CheckboxSettingView
../settingviews/slider_setting_view : SliderSettingView
###

class ControlsCategoryView extends Backbone.Marionette.CompositeView

  # TODO: remove accordion* classes after bootstrap 3 update

  template : _.template("""
    <div class="panel panel-default accordion-group">
      <div class="panel-heading accordion-heading">
        <a class="panel-title accordion-toggle" data-toggle="collapse" data-parent="#user-settings" href="#user-settings-controls">
          Controls
        </a>
      </div>
      <div id="user-settings-controls accordion-body" class="panel-collapse collapse in">
        <div class="panel-body accordion-inner">

          <div data-subview="inverseX"></div>
          <div data-subview="inverseY"></div>
          <div data-subview="keyboardDelay"></div>

        </div>
      </div>
    </div>
  """)


  initialize : ->

    Backbone.Subviews.add(this)


  subviewCreators :

    "inverseX" : ->

      return new CheckboxSettingView(
        model : @model
        options :
          name : "inverseX"
          displayName : "Inverse X"
      )

    "inverseY" : ->

      return new CheckboxSettingView(
        model : @model
        options :
          name : "inverseY"
          displayName : "Inverse Y"
      )

    "keyboardDelay" : ->

      return new SliderSettingView(
        model : @model
        options :
          name : "keyboardDelay"
          displayName : "Keyboard delay (ms)"
          min : 0
          max : 500
      )
