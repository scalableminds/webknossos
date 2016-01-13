_                  = require("lodash")
Marionette         = require("backbone.marionette")
routes             = require("routes")
TaskTypeCollection = require("admin/models/tasktype/task_type_collection")
TeamCollection     = require("admin/models/team/team_collection")
ProjectCollection  = require("admin/models/project/project_collection")
DatasetCollection  = require("admin/models/dataset/dataset_collection")
SelectionView      = require("admin/views/selection_view")
Toast              = require("libs/toast")

class TaskCreateView extends Marionette.LayoutView

  id : "task-edit"
  className : "container wide task-type-administration"

  template : _.template("""
  <h3>Edit Task</h3>
  All tracings of this task are going to get adjusted to this settings. This is espacially true when changing the Task type.<br /><br />
  <div class="well clearfix">
    <div class="col-sm-9 col-sm-offset-2 clearfix">

      <form id="editForm" action="" method="POST" class="form-horizontal" onSubmit="return false;">

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
            <input type="text" class="form-control" name="experience.domain" value="<%= neededExperience.domain %>" id="experience_domain" data-source="[]" data-provide="typeahead" autocomplete="off" placeholder="Enter a domain">
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
          <label class="col-sm-2 control-label" for="status_open">Task instances</label>
          <div class="col-sm-9">
            <input type="number" id="status_open" name="status.open" value="<%= status.open %>" min="1" class="form-control">
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="team">Team</label>
          <div class="col-sm-9 team">
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="projectName">Project</label>
          <div class="col-sm-9 project">
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="boundingBox">Bounding Box</label>
          <div class="col-sm-9">
            <span class="help-block hints"></span>
            <input
              type="text"
              id="boundingBox"
              name="boundingBox"
              placeholder="topLeft.x, topLeft.y, topLeft.z, width, height, depth"
              pattern="(\\s*\\d+\\s*,){5}(\\s*\\d+\\s*)"
              title="topLeft.x, topLeft.y, topLeft.z, width, height, depth"
              value="<%= boundingBox.topLeft[0] %>, <%= boundingBox.topLeft[1] %>, <%= boundingBox.topLeft[2] %>, <%= boundingBox.width %>, <%= boundingBox.height %>, <%= boundingBox.depth %>"
              required=true
              class="form-control">
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="dataSet">Dataset</label>
          <div class="col-sm-9 dataSet">
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="editPosition">Start</label>
          <div class="col-sm-9">
            <input
              type="text"
              id="editPosition"
              name="editPosition"
              placeholder="x, y, z"
              title="x, y, z"
              pattern="(\\s*\\d+\\s*,){2}(\\s*\\d+\\s*)"
              value="<%= editPosition[0] %>, <%= editPosition[1] %>, <%= editPosition[2] %>"
              required=true
              class="form-control">
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class="form-group">
          <div class="col-sm-2 col-sm-offset-2">
            <button id="submitButton" type="submit" class="form-control btn btn-primary">Save</button>
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

  events:
    "submit" : "submit"

  ui:
    neededExperience_value : "#experience_value"
    neededExperience_domain : "#experience_domain"
    priority : "#priority"
    status_open : "#status_open"
    boundingBox : "#boundingBox"
    editPosition: "#editPosition"
    submitButton : "#submit"

  initialize : (options) ->

    # TODO: remove this debug line
    console.log("initialize", @model)

    @listenTo(@model, 'sync', =>
      @render()
      @afterSync()
    )

    # catch no-found errors
    @listenTo(@model, 'error', @syncError)
    @model.fetch()


  submit : ->

    # block submit button
    @ui.submitButton.prop("disabled", true)
    @ui.submitButton.addClass("disabled")

    @updateModel()

    # unblock submit button after model synched
    # show a status flash message
    @model.save({},
      error : =>
        @ui.submitButton.prop("disabled", false)
        @ui.submitButton.removeClass("disabled")

        @showSaveError()

      success : =>

        @showSaveSuccess()
        app.router.navigate("tasks", {trigger: true})
    )

    return false


  ###*
   * Toast a success message.
  ###
  showSaveSuccess: ->

    Toast.success('The task was successfully created')


  ###*
   * Toast an error message.
  ###
  showSaveError: ->

    Toast.error('The task could not be created due to server errors.')


  ###*
   * Update model with form values.
   ###
  updateModel : ->

    # set and typecast form values into model
    @model.set(
      neededExperience :
        # parse minimum experience to integer
        value : parseInt( @ui.neededExperience_value.val() )
        domain : @ui.neededExperience_domain.val()
      status :
        # parse number of instances to integer
        open : parseInt( @ui.status_open.val() )
        # cannot nest model attributes
        # insert existign vars to maintain model defaults
        inProgress : @model.get("status").inProgress
        completed : @model.get("status").completed
      # parse priority, range 0 to 100, to integer
      priority : parseInt( @ui.priority.val() )

      # split string by comma delimiter, trim whitespace and cast to integer
      # access from subview
      boundingBox : do =>
        intArray = _.map(@ui.boundingBox.val().split(","), (number) ->
          parseInt( number.trim() )
        )

        # user input could be too short
        # insert a 0 instead
        return {
          topLeft: [
            intArray[0] || 0,
            intArray[1] || 0,
            intArray[2] || 0
          ],
          width: intArray[3] || 0,
          height: intArray[4] || 0,
          depth: intArray[5] || 0
        }

      # split string by comma delimiter, trim whitespace and cast to integer
      editPosition : _.map(@ui.editPosition.val().split(","), (number) ->
          parseInt( number.trim() )
        )
    )

    # update models from subviews
    @taskTypeSelectionView.updateModel()
    @teamSelectionView.updateModel()
    @projectSelectionView.updateModel()
    @dataSetSelectionView.updateModel()


  ###*
   * Render the SelectionViews based on the stored options.
   * Has to be after `model.sync()` so showing subviews won't break
   * Marionette
   ###
  afterSync: ->

    # TODO: remove this debug line
    console.log("model", @model)

    # the value of the tasktype is the id and the displayed innerHTML is the summary
    @taskTypeSelectionView = new SelectionView(
      collection: new TaskTypeCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("id")}"
        modelName: -> return "#{@model.get("summary")}"
      data : "amIAnAdmin=true"
      name: "taskTypeId"
      parentModel : @model
    )

    @teamSelectionView = new SelectionView(
      collection : new TeamCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true"
      name: "team"
      parentModel : @model
    )

    @projectSelectionView = new SelectionView(
      collection: new ProjectCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true"
      name: "projectName"
      parentModel : @model
    )

    @dataSetSelectionView = new SelectionView(
      collection: new DatasetCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true&isActive=true"
      name: "dataSet"
      parentModel : @model
    )

    @dataSet.show(@dataSetSelectionView)
    @taskType.show(@taskTypeSelectionView)
    @team.show(@teamSelectionView)
    @project.show(@projectSelectionView)

    return


  ###*
   * Handle not-found errors.
   ###
  syncError : ->

    Toast.error("The task was not found.")
    app.router.navigate("tasks", {trigger: true})

    return

module.exports = TaskCreateView
