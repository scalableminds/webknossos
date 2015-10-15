### define
underscore : _
backbone.marionette : Marionette
libs/toast : Toast
admin/views/selection_view : SelectionView
admin/models/team/team_collection : TeamCollection
fileinput : Fileinput
###

class DatasetUploadView extends Backbone.Marionette.LayoutView

  template : _.template("""
    <div class="row">
      <div class="col-md-6">
        <h3>Import Dataset</h3>
        <form action="/api/datasets/upload" method="POST" class="form-horizontal" enctype="multipart/form-data">
          <div class=" form-group">
            <label class="col-sm-3 control-label" for="name">Name</label>
            <div class="col-sm-9">
            <input type="text" id="name" name="name" value="" class="form-control">
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
            <label class="col-sm-3 control-label" for="scale_scale">Scale</label>
            <div class="col-sm-9">
              <input type="text" id="scale_scale" name="scale.scale" value="12.0, 12.0, 24.0" class="form-control" pattern="\s*([0-9]+(?:\.[0-9]+)?),\s*([0-9]+(?:\.[0-9]+)?),\s*([0-9]+(?:\.[0-9]+)?)\s*" title="Specify dataset scale like &quot;XX, YY, ZZ&quot;">
              <span class="help-block errors"></span>
            </div>
          </div>
          <div class=" form-group">
            <label class="col-sm-3 control-label" for="zipFile">Dataset ZIP File</label>
            <div class="col-sm-9">

              <div class="fileinput fileinput-new input-group" data-provides="fileinput">
                <div class="form-control" data-trigger="fileinput">
                  <i class="fa fa-file fileinput-exists"></i>
                  <span class="fileinput-filename"></span>
                </div>
                <span class="input-group-addon btn btn-default btn-file">
                  <span class="fileinput-new">Browse...</span>
                  <span class="fileinput-exists">Change</span>
                  <input type="file" accept="application/zip" name="zipFile">
                </span>
                <a href="#" class="input-group-addon btn btn-default fileinput-exists" data-dismiss="fileinput">Remove</a>
              </div>
            </div>
          </div>
          <div class="form-group">
            <div class="col-sm-9 col-sm-offset-3">
              <button type="submit" class="form-control btn btn-primary">Import</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  """)

  className : "container dataset-administration"

  regions :
    "team" : ".team"

  events :
    "submit form" : "uploadDataset"
    "change input[type=file]" : "createProject"

  ui :
    "form" : "form"

  initialize : ->

    @teamSelectionView = new SelectionView(
      viewComparator: "name"
      collection : new TeamCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true"
    )


  onRender : ->

    @team.show(@teamSelectionView)

