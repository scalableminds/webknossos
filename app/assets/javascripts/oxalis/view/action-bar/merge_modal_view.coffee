_                        = require("lodash")
Marionette               = require("backbone.marionette")
Toast                    = require("libs/toast")
Request                  = require("libs/request")
app                      = require("app")
UserAnnotationCollection = require("oxalis/model/skeletontracing/user_annotation_collection")
SelectionView            = require("admin/views/selection_view")
UserCollection           = require("admin/models/user/user_collection")
TeamCollection           = require("admin/models/team/team_collection")
TaskCollection           = require("admin/models/task/task_collection")
TaskTypeCollection       = require("admin/models/tasktype/task_type_collection")
ProjectCollection        = require("admin/models/project/project_collection")
ProjectModel             = require("admin/models/project/project_model")
jsRoutes                 = require("routes")

class MergeModalView extends Marionette.LayoutView

  className : "modal fade"
  template : _.template("""
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
          <h3>Merge</h3>
        </div>
        <div class="modal-body container-fluid">
          <div class="form-group">
            <label for="task">Task</label>
            <div class="row">
              <div class="col-md-10 task"></div>
              <div class="col-md-2">
                <button class="btn btn-primary" id="task-merge">Merge</button>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label for="task-type">Task type</label>
            <div class="row">
              <div class="col-md-10 task-type"></div>
              <div class="col-md-2">
                <button class="btn btn-primary" id="task-type-merge">Merge</button>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label for="project">Project</label>
            <div class="row">
              <div class="col-md-10 project"></div>
              <div class="col-md-2">
                <button class="btn btn-primary" id="project-merge">Merge</button>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label for="nml">NML</label>
            <div class="row">
              <div class="col-md-10">
                <form action="<%- jsRoutes.controllers.admin.NMLIO.upload().url %>"
                    method="POST"
                    enctype="multipart/form-data"
                    id="upload-and-explore-form"
                    class="inline-block">

                    <div class="fileinput fileinput-new input-group" data-provides="fileinput">
                      <div class="form-control" data-trigger="fileinput">
                        <span class="fileinput-filename"></span>
                      </div>
                      <span class="input-group-addon btn btn-default btn-file">
                        <span class="fileinput-new">
                          <i class="fa fa-upload"></i>
                          Upload NML
                        </span>
                        <span class="fileinput-exists">
                          <i class="fa fa-upload hide" id="form-upload-icon"></i>
                          <i class="fa fa-spinner fa-spin" id="form-spinner-icon"></i>
                          Change</span>
                        <input type="file" name="nmlFile" accept=".nml">
                      </span>
                    </div>
                </form>
              </div>
              <div class="col-md-2">
                <button class="btn btn-primary" id="nml-merge">Merge</button>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label for="explorative">Explorativs</label>
            <div class="row">
              <div class="col-md-10 explorative"></div>
              <div class="col-md-2">
                <button class="btn btn-primary" id="explorative-merge">Merge</button>
              </div>
            </div>
          </div>
          <hr>
          <div class="checkbox hidden">
            <label>
              <input type="checkbox" id="checkbox-read-only">
              The merged tracing will be read-only.
            </label>
          </div>
          <div>
            The merged tracing will be saved as a new explorative tracing.
          </div>
        </div>
      </div>
    </div>
  """)

  regions :
    "task"        : ".task"
    "tasktype"    : ".task-type"
    "project"     : ".project"
    "explorative" : ".explorative"

  events :
    "click #task-merge"               : "mergeTask"
    "click #task-type-merge"          : "mergeTaskType"
    "click #project-merge"            : "mergeProject"
    "click #nml-merge"                : "mergeNml"
    "change input[type=file]"         : "selectFiles"
    "submit @ui.uploadAndExploreForm" : "uploadFiles"
    "click #explorative-merge"        : "mergeExplorative"
    "change.bs.fileinput"             : "selectFiles"

  ui :
    "task"                 : ".task"
    "tasktype"             : ".task-type"
    "project"              : ".project"
    "explorative"          : ".explorative"
    "uploadAndExploreForm" : "#upload-and-explore-form"
    "formSpinnerIcon"      : "#form-spinner-icon"
    "formUploadIcon"       : "#form-upload-icon"
    "fileInput"            : ":file"


  initialize : ->

    @nml = undefined


  show : ->

    @$el.modal("show")

    Request.receiveJSON("/api/user").then( (user) =>
      @taskSelectionView = new SelectionView(
        collection : new  TaskCollection()
        childViewOptions :
          modelValue: -> return "#{@model.get("id")}"
      )
      @taskTypeSelectionView = new SelectionView(
        collection : new  TaskTypeCollection()
        childViewOptions :
          modelValue: -> return "#{@model.get("summary")}"
      )
      @projectSelectionView = new SelectionView(
        collection : new  ProjectCollection()
        childViewOptions :
          modelValue: -> return "#{@model.get("name")}"
      )
      @explorativSelectionView = new SelectionView(
        collection : new UserAnnotationCollection(id : user.id)
        childViewOptions :
          modelValue: -> return "#{@model.get("id")}"
      )

      @task       .show(@taskSelectionView)
      @tasktype   .show(@taskTypeSelectionView)
      @project    .show(@projectSelectionView)
      @explorative.show(@explorativSelectionView)
    )


  mergeTask : ->

    taskId = @ui.task.find("select :selected").val()
    url = "/annotations/CompoundTask/#{taskId}/merge/#{@model.get("tracingType")}/#{@model.get("tracingId")}"
    @merge(url)


  mergeTaskType : ->

    taskTypeId = @ui.tasktype.find("select :selected").prop("id")
    url = "/annotations/CompoundTaskType/#{taskTypeId}/merge/#{@model.get("tracingType")}/#{@model.get("tracingId")}"
    @merge(url)


  mergeProject : ->

    projectId = @ui.project.find("select :selected").prop("id")
    url = "/annotations/CompoundProject/#{projectId}/merge/#{@model.get("tracingType")}/#{@model.get("tracingId")}"
    @merge(url)


  mergeNml : ->

    if @nml
      url = "/annotations/#{@nml.typ}/#{@nml.id}/merge/#{@model.get("tracingType")}/#{@model.get("tracingId")}"
      @merge(url)
    else
      Toast.error("Please upload NML file")


  mergeExplorative : ->

    explorativId = @ui.explorative.find("select :selected").val()
    url = "/annotations/Explorational/#{explorativId}/merge/#{@model.get("tracingType")}/#{@model.get("tracingId")}"
    @merge(url)


  merge : (url) ->

    readOnly = document.getElementById('checkbox-read-only').checked

    Request.receiveJSON("#{url}/#{readOnly}").then( (annotation) ->

      Toast.message(annotation.messages)

      redirectUrl = "/annotations/#{annotation.typ}/#{annotation.id}"

      app.router.loadURL(redirectUrl)

    )


  selectFiles : (event) ->

    if @ui.fileInput[0].files.length
      @ui.uploadAndExploreForm.submit()


  toggleIcon : (state) ->

    @ui.formSpinnerIcon.toggleClass("hide", state)
    @ui.formUploadIcon.toggleClass("hide", !state)


  uploadFiles : (event) ->

    event.preventDefault()
    @toggleIcon(false)

    form = @ui.uploadAndExploreForm

    Request.always(
      Request.sendMultipartFormReceiveJSON(
        form.attr("action")
        data : new FormData(form[0])
      ).then((data) =>
        @nml = data.annotation
        Toast.message(data.messages)
      )
      => @toggleIcon(true)
    )

module.exports = MergeModalView
