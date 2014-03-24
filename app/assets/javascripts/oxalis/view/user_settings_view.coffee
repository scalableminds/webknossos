### define
backbone.marionette : marionette
underscore : _
###

class UserSettingsView extends Backbone.Marionette.ItemView

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

            <label class="checkbox">
              <input type="checkbox" <%= boolToChecked(inverseX) %> data-attribute="inverseX"> Inverse X
            </label>
            <label class="checkbox">
              <input type="checkbox" <%= boolToChecked(inverseY) %> data-attribute="inverseY"> Inverse Y
            </label>

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


  templateHelpers :
    boolToChecked : (bool) ->
      return if bool then "checked" else ""


  events :
    "change [data-attribute][type=checkbox]" : "handleCheckboxChange"


  initialize : ->

    @listenTo(@model, "change", @render)


  handleCheckboxChange : (evt) ->

    attribute = $(evt.target).data("attribute")
    value = evt.target.checked

    console.log attribute, value
    @model.set(attribute, evt.target.checked)


  render : ->

    console.log "render"
    super(arguments...)
