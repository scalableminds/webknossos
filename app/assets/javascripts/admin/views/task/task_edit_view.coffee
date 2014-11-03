### define
underscore : _
backbone.marionette : marionette
routes : routes
admin/models/tasktype/task_type_collection : TaskTypeCollection
admin/models/team/team_collection : TeamCollection
admin/models/project/project_collection : ProjectCollection
admin/models/dataset/dataset_collection : DatasetCollection
admin/views/selection_view : SelectionView
libs/toast : Toast
###

class TaskCreateView extends Backbone.Marionette.LayoutView

  id : "task-edit"
  className : "container wide task-type-administration"
  # TODO: make the template DRY somehow :S
  # TODO: test save
  template : _.template("""
  <h3>Edit Task</h3>
  All tracings of this task are going to get adjusted to this settings. This is espacially true when changing the Task type.<br /><br />
  <div class="well clearfix">
    <div class="col-sm-9 col-sm-offset-2 clearfix">

      <form action="/admin/tasks/<%= id %>" method="POST" class="form-horizontal">
        <div class=" form-group">
          <label class="col-sm-2 control-label" for="taskType">Task type</label>
          <div class="col-sm-9">
            <div class="taskType"></div>
            <span class="help-block">
              <a href="/taskTypes">Create a new Type</a>
            </span>
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="experience_domain">Experience Domain</label>
          <div class="col-sm-9">
            <input type="text" class="form-control" name="experience.domain" value="<%= neededExperience.domain %>" id="experience_domain" data-source="[]" data-provide="typeahead" autocomplete="off">
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="experience_value">Min Experience</label>
          <div class="col-sm-9">
            <input type="number" id="experience_value" name="experience.value" value="<%= neededExperience.value %>" class="form-control">
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="priority">Priority</label>
          <div class="col-sm-9">
            <input type="number" id="priority" name="priority" value="<%= priority %>" class="form-control">
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="taskInstances">Task instances</label>
          <div class="col-sm-9">
            <input type="number" id="taskInstances" name="taskInstances" value="<%= status.open %>" min="1" class="form-control">
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="team">Team</label>
          <div class="col-sm-9 team">
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="project">Project</label>
          <div class="col-sm-9 project">
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="dataSet">Dataset</label>
          <div class="col-sm-9 dataSet">
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="start_point">Start</label>
          <div class="col-sm-9">
            <input type="text" id="start_point" name="start.point" value="<%= editPosition %>" class="form-control">
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="boundingBox_box">Bounding Box</label>
          <div class="col-sm-9">
            <input type="text" id="boundingBox" name="boundingBox" value="<%= boundingBox %>" class="form-control">
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class="form-group">
          <div class="col-sm-2 col-sm-offset-2">
            <button type="submit" class="form-control btn btn-primary">Save</button>
          </div>
          <div class="col-sm-2">
            <a class="form-control btn btn-default" href="/tasks">Cancel</a>
          </div>
        </div>
      </form>
    </div>
  </div> <!-- END .well -->
  """)

  regions:
    # select inputs
    "taskType" : ".taskType"
    "team"     : ".team"
    "project"  : ".project"
    "dataSet" : ".dataSet"


  initialize : (options) ->

    # TODO: remove this debug line
    console.log("initialize", @model)

    @listenTo(@model, 'sync', =>
        @render()
        @afterSync()
    )

    # catch no-found errors
    @listenTo(@model, 'error', =>
        @syncError()
    )
    @model.fetch()

  ###*
   * Render the SelectionViews based on the stored options.
   * Has to be after `model.sync()` so showing subviews won't break
   * Marionette
   *
   * @method afterSync
   ###
  afterSync: ->

    # TODO: remove this debug line
    console.log("model", @model)

    # the value of the tasktype is the id and the displayed innerHTML is the summary
    taskTypeSelectionView = new SelectionView(
      collection: new TaskTypeCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("id")}"
        modelName: -> return "#{@model.get("summary")}"
      data : "amIAnAdmin=true"
      name: "taskType"
      active : @model.get("type").id
    )

    teamSelectionView = new SelectionView(
      collection : new TeamCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true"
      name: "team"
      active : @model.get("team")
    )

    projectSelectionView = new SelectionView(
      collection: new ProjectCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true"
      name: "project"
      active : @model.get("projectName")
    )

    dataSetSelectionView = new SelectionView(
      collection: new DatasetCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true"
      name: "dataSet"
      active : @model.get("dataSet")
    )

    @dataSet.show(dataSetSelectionView)
    @taskType.show(taskTypeSelectionView)
    @team.show(teamSelectionView)
    @project.show(projectSelectionView)

    return

  ###*
   * Handle not-found errors.
   *
   * @method syncError
   ###
  syncError : ->
    # TODO: notify the user that the task was not found
    Toast.error("The task was not found.")

    window.app.router.navigate("tasks", {trigger: true})

    return
