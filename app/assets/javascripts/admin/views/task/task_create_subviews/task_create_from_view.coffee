### define
underscore : _
backbone.marionette : marionette
routes : routes
admin/models/tasktype/task_type_collection : TaskTypeCollection
admin/models/team/team_collection : TeamCollection
admin/models/project/project_collection : ProjectCollection
admin/views/selection_view : SelectionView
./task_create_from_form_view : TaskCreateFromFormView
./task_create_from_nml_view : TaskCreateFromNMLView
libs/toast : Toast
###

class TaskCreateFromView extends Backbone.Marionette.LayoutView

  # which type of form is created?
  # from_form/ from_nml
  type : null

  id : "create-from"
  template : _.template("""
  <div class="row">
    <div class="col-sm-12">
    <div class="well">
      <div class="col-sm-9 col-sm-offset-2">
        <% if (type == "from_form") { %>
          <h3>Create Task</h3>
          <br/>
        </div>
        <form action="" method="POST" class="form-horizontal" onSubmit="return false;">
        <% } else if (type == "from_nml") { %>
          <h3>Create Task from explorative SkeletonTracing</h3>
          <p>Every nml creates a new task. You can either upload a single NML file or a zipped collection of nml files (.zip).</p>
          <br/>
        </div>
        <form action="/admin/tasks/createFromNML" method="POST" class="form-horizontal">
        <% } %>

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
            <input type="text" class="form-control" name="experience.domain" value="" id="experience_domain" data-source="[]" data-provide="typeahead" autocomplete="off">
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="experience_value">Min Experience</label>
          <div class="col-sm-9">
            <input type="number" id="experience_value" name="experience.value" value="0" class="form-control">
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="priority">Priority</label>
          <div class="col-sm-9">
            <input type="number" id="priority" name="priority" value="100" class="form-control">
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class=" form-group">
          <label class="col-sm-2 control-label" for="status_open">Task instances</label>
          <div class="col-sm-9">
            <input type="number" id="status_open" name="status.open" value="10" min="1" class="form-control">
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

        <div class="subview">

        </div>

        <div class="form-group">
          <div class="col-sm-2 col-sm-offset-9">
            <button id="submit" type="submit" class="form-control btn btn-primary">Create</button>
          </div>
        </div>

      </form>
    </div>
    </div>
  </div>
  """)

  initialize: (options) ->

    if options.type
      @type = options.type

    return

  # make the variable available inside the underscore template
  templateHelpers: ->

    type : @type

  regions:
    "taskType" : ".taskType"
    "team"     : ".team"
    "project"  : ".project"
    "subview"  : ".subview"

  events :
    "submit" : "submit"

  ui :
    neededExperience_value : "#experience_value"
    neededExperience_domain : "#experience_domain"
    priority : "#priority"
    status_open : "#status_open"
    submitButton : "#submit"

  ###*
    * Submit form data as json.
    *
    * @method submit
    ###
  submit : ->

    # block submit button
    @ui.submitButton.prop("disabled", true)
    @ui.submitButton.addClass("disabled")

    # load form contents into model
    @updateModel()

    # send form data to server
    # unblock submit button after model synched
    # show a status flash message
    @model.save({},
      error : =>
        @ui.submitButton.prop("disabled", false)
        @ui.submitButton.removeClass("disabled")

        @showSaveError()

      success : =>
        @ui.submitButton.prop("disabled", false)
        @ui.submitButton.removeClass("disabled")

        @showSaveSuccess()
    )

    # prevent actual submitting
    return false

  ###*
   * Update the model with the value from form.
   ###
  updateModel : ->

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
    )

    # update models from subviews
    @taskTypeSelectionView.updateModel()
    @teamSelectionView.updateModel()
    @projectSelectionView.updateModel()

    if @createFromFormView?
      @createFromFormView.updateModel()

    if @createFromNMLView?
      @createFromNMLView.updateModel()

    return


  showSaveSuccess: ->

    Toast.success('The task was successfully created')


  showSaveError: ->

    Toast.error('The task could not be created due to server errors.')


  showInvalidData: ->

    Toast.error('The form data is not correct.')

  ###*
  * Render the SelectionViews based on the stored options
  * creates a subview based on the passed type: from_form / from_nml
  *
  * @method onRender
  ###
  onRender: ->

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

    # render subviews in defined regions
    @taskType.show(@taskTypeSelectionView)
    @team.show(@teamSelectionView)
    @project.show(@projectSelectionView)

    if (@type == "from_form")
      @createFromFormView = new TaskCreateFromFormView(model : @model)
      @subview.show(@createFromFormView)
    else
      @createFromNMLView = new TaskCreateFromNMLView(model : @model)
      @subview.show(@createFromNMLView)
