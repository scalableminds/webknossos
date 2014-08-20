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
                <a href="@controllers.routes.AnnotationController.download(annotation.typ, annotation.id)" class="btn btn-default input-block-level form-control" id="trace-download-button"><i class="fa fa-download"></i>NML</a>
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
    "click #explorativs-merge" : "mergeExplorativs"

  ui :
    "task"        : ".task"
    "tasktype"    : ".task-type"
    "project"     : ".project"
    "explorativs" : ".explorativs"

  @annotationId  = $("#annotationId").val()
  @annotationTyp = $("#annotationTyp").val()

  show : ->
    debugger
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
    task = @ui.task.find("select :selected").val()


  mergeTaskType : ->
    console.log("mergeTaskType")

  mergeProject : ->
    console.log("mergeProject")

  mergeNml : ->
    console.log("mergeNml")


  destroyModal : ->

    # The event is neccesarry due to the 300ms CSS transition
    @$el.on("hidden.bs.modal", =>
      @$el.off("hidden.bs.modal")
      app.vent.trigger("CreateProjectModal:refresh") #update pagination
    )
    @$el.modal("hide")

