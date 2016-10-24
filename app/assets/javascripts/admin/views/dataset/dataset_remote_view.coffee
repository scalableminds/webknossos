_               = require("lodash")
Marionette      = require("backbone.marionette")
Toast           = require("libs/toast")
Request         = require("libs/request")
FormSyphon      = require("form-syphon")
SelectionView   = require("admin/views/selection_view")
TeamCollection  = require("admin/models/team/team_collection")

class DatasetRemoteView extends Marionette.View

  template : _.template("""
    <div class="row">
      <div class="col-md-6">
        <h3>Add Remote NDStore Dataset</h3>
        <form action="/api/datasets?typ=ndstore" method="POST" class="form-horizontal">
          <div class=" form-group">
            <label class="col-sm-3 control-label" for="name">Name</label>
            <div class="col-sm-9">
            <input type="text" required name="name" value="" class="form-control">
              <span class="help-block errors"></span>
            </div>
          </div>
          <div class=" form-group">
            <label class="col-sm-3 control-label" for="team">Team</label>
            <div class="col-sm-9 team">
              <span class="help-block errors"></span>
            </div>
          </div>
          <div class=" form-group">
            <label class="col-sm-3 control-label" for="server">Server Url</label>
            <div class="col-sm-9">
              <input type="url" required name="server" class="form-control" title="NDstore server location">
              <span class="help-block errors"></span>
            </div>
          </div>
          <div class=" form-group">
            <label class="col-sm-3 control-label" for="token">Token</label>
            <div class="col-sm-9">
              <input type="text" required name="token" class="form-control" title="NDstore token">
              <span class="help-block errors"></span>
            </div>
          </div>
          <div class="form-group">
            <div class="col-sm-9 col-sm-offset-3">
              <button type="submit" class="form-control btn btn-primary">
                Import
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  """)

  className : "container"

  regions :
    "team" : ".team"

  events :
    "submit form" : "addDataset"

  ui :
    form : "form"

  initialize : ->

    @teamSelectionView = new SelectionView(
      collection : new TeamCollection()
      name : "team"
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true"
    )


  onRender : ->

    @showChildView("team", @teamSelectionView)


  addDataset : (evt) ->

    evt.preventDefault()
    form = @ui.form

    if form[0].checkValidity()

      Request.sendJSONReceiveJSON("/api/datasets?typ=ndstore",
        data : FormSyphon.serialize(form)
      )
      .then(
        ->
          Toast.success()
          app.router.navigate("/dashboard", { trigger: true })
        -> # NOOP
      )


module.exports = DatasetRemoteView
