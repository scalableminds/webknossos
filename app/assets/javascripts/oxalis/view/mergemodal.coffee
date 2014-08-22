### define
underscore : _
backbone.marionette : Marionette
libs/toast : Toast
app : app
../model/skeletontracing/user_annotation_model : UserAnnotationModel
admin/views/selection_view : SelectionView
admin/models/user/user_collection : UserCollection
admin/models/team/team_collection : TeamCollection
admin/models/task/task_collection : TaskCollection
admin/models/tasktype/task_type_collection : TaskTypeCollection
admin/models/project/project_collection : ProjectCollection
admin/models/project/project_model : ProjectModel
routes : MyJSRoutesModule
###

class MergeModalView extends Backbone.Marionette.LayoutView

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
            <div class="row clearfix">
              <div class="col-md-10 column task"></div>
              <div class="col-md-2 column ">
                <button class="btn btn-primary" id="task-merge">Merge</button>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label for="task-type">Task type</label>
            <div class="row clearfix">
              <div class="col-md-10 column task-type"></div>
              <div class="col-md-2 column ">
                <button class="btn btn-primary" id="task-type-merge">Merge</button>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label for="project">Project</label>
            <div class="row clearfix">
              <div class="col-md-10 column project"></div>
              <div class="col-md-2 column ">
                <button class="btn btn-primary" id="project-merge">Merge</button>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label for="nml">NML</label>
            <div class="row clearfix">
              <div class="col-md-10 column">
                <form action="<%= jsRoutes.controllers.admin.NMLIO.upload().url %>"
                    method="POST"
                    enctype="multipart/form-data"
                    id="upload-and-explore-form"
                    class="form-inline inline-block">
                  <span class="btn-file btn btn-default">
                    <input type="file" name="nmlFile" multiple>
                      <i class="fa fa-upload" id="form-upload-icon"></i>
                      <i class="fa fa-spinner fa-spin hide" id="form-spinner-icon"></i>
                      Upload NML
                    </input>
                  </span>
                </form>
              </div>
              <div class="col-md-2 column ">
                <button class="btn btn-primary" id="nml-merge">Merge</button>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label for="explorativs">Explorativs</label>
            <div class="row clearfix">
              <div class="col-md-10 column explorativs"></div>
              <div class="col-md-2 column ">
                <button class="btn btn-primary" id="explorativs-merge">Merge</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  """)

  regions :
    "task"        : ".task"
    "tasktype"    : ".task-type"
    "project"     : ".project"
    "explorativs" : ".explorativs"

  events :
    "click #task-merge"        : "mergeTask"
    "click #task-type-merge"   : "mergeTaskType"
    "click #project-merge"     : "mergeProject"
    "click #nml-merge"         : "mergeNml"
    "submit @ui.uploadAndExploreForm" : "uploadFiles"
    "click #explorativs-merge" : "mergeExplorativs"

  ui :
    "task"        : ".task"
    "tasktype"    : ".task-type"
    "project"     : ".project"
    "explorativs" : ".explorativs"
    "uploadAndExploreForm" : "#upload-and-explore-form"

  initialize : (options) ->

    @_model = options._model

  show : ->

    @$el.modal("show")

    $.ajax(url: "/api/user").done((user) =>

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
      # @explorativSelectionView = new SelectionView(
      #   collection : new UserAnnotationModel(id : user.id)
      #   # data : "amIAnAdmin=true"
      #   childViewOptions :
      #     modelValue: -> return "#{@model.get("name")}"
      # )

      @task.show(@taskSelectionView)
      @tasktype.show(@taskTypeSelectionView)
      @project.show(@projectSelectionView)
      # @explorativs.show(@explorativSelectionView)
    )

  mergeTask : ->
    taskId = @ui.task.find("select :selected").val()
    $.ajax(url: "/annotations/CompoundTask/#{taskId}/merge/#{@_model.tracingType}/#{@_model.tracingId}").done((annotation) ->
      window.location.replace("/annotations/#{annotation.typ}/#{annotation.id}")
    )

  mergeTaskType : ->
    taskTypeId = @ui.tasktype.find("select :selected").prop("id")
    $.ajax(url: "/annotations/CompoundTaskType/#{taskTypeId}/merge/#{@_model.tracingType}/#{@_model.tracingId}").done((annotation) ->
      window.location.replace("/annotations/#{annotation.typ}/#{annotation.id}")
    )

  mergeProject : ->
    projectId = @ui.project.find("select :selected").prop("id")
    $.ajax(url: "/annotations/CompoundProject/#{projectId}/merge/#{@_model.tracingType}/#{@_model.tracingId}").done((annotation) ->
      window.location.replace("/annotations/#{annotation.typ}/#{annotation.id}")
    )

  mergeNml : ->
    console.log("mergeNml")


  destroyModal : ->

    # The event is neccesarry due to the 300ms CSS transition
    @$el.on("hidden.bs.modal", =>
      @$el.off("hidden.bs.modal")
      app.vent.trigger("CreateProjectModal:refresh") #update pagination
    )
    @$el.modal("hide")

