_              = require("lodash")
app            = require("app")
FormSyphon     = require("form-syphon")
Marionette     = require("backbone.marionette")
Toast          = require("libs/toast")

class DatasetEditView extends Marionette.View

  template : _.template("""
    <div class="row">
      <div class="col-sm-12">
        <div class="well">
          <div class="col-sm-9 col-sm-offset-2">
            <h3>Update dataset</h3>
          </div>

          <form method="POST" class="form-horizontal">
            <div class="form-group">
              <label class="col-sm-2 control-label" for="name">Name</label>
              <div class="col-sm-9">
                <input type="text" id="name" name="name" value="<%- name %>" class="form-control" readonly />
              </div>
            </div>
            <div class="form-group">
              <label class="col-sm-2 control-label" for="description">Description</label>
              <div class="col-sm-9">
                <input type="text" id="description" name="description" value="<%- description %>" class="form-control" />
              </div>
            </div>
            <div class="form-group">
              <label class="col-sm-3 col-sm-offset-2" for="isPublic">
                <input type="checkbox" id="isPublic" name="isPublic" <%- isChecked(isPublic) %>>
                  publicly accessible
              </label>
            </div>
            <div class="form-group">
              <div class="col-sm-2 col-sm-offset-9">
              <button type="submit" class="form-control btn btn-primary">Update</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  """)

  className : "container wide dataset-administration"

  templateContext : ->
    isChecked : (bool) -> return "checked" if bool

  events :
    "submit form" : "submitForm"

  ui :
    "form" : "form"


  initialize : ->

    @listenTo(@model, "sync", @render)
    @model.fetch()


  submitForm : (event) ->

    event.preventDefault()

    if not @ui.form[0].checkValidity()
      Toast.error("Please supply all needed values.")
      return

    formValues = FormSyphon.serialize(@ui.form)

    @model.save(formValues).then(
      -> Toast.success("Saved!")
    )


module.exports = DatasetEditView
