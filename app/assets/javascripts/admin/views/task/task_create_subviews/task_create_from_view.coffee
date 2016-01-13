_                       = require("lodash")
Marionette              = require("backbone.marionette")
routes                  = require("routes")
TaskTypeCollection      = require("admin/models/tasktype/task_type_collection")
TeamCollection          = require("admin/models/team/team_collection")
ProjectCollection       = require("admin/models/project/project_collection")
SelectionView           = require("admin/views/selection_view")
TaskCreateFromFormView  = require("./task_create_from_form_view")
TaskCreateFromNMLView   = require("./task_create_from_nml_view")
Toast                   = require("libs/toast")

class TaskCreateFromView extends Marionette.LayoutView

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
        <% } else if (type == "from_nml") { %>
          <h3>Create Task from explorative SkeletonTracing</h3>
          <p>Every nml creates a new task. You can either upload a single NML file or a zipped collection of nml files (.zip).</p>
          <br/>
        </div>
        <% } %>
        <form id="createForm" action="" method="POST" class="form-horizontal" onSubmit="return false;">

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
            <input type="text" class="form-control" name="experience.domain" value="" id="experience_domain" data-source="[]" data-provide="typeahead" autocomplete="off" placeholder="Enter a domain">
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
              value="0, 0, 0, 0, 0, 0"
              required=true
              class="form-control">
            <span class="help-block errors"></span>
          </div>
        </div>

        <div class="subview"></div>

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
    form: "#createForm"
    neededExperience_value : "#experience_value"
    neededExperience_domain : "#experience_domain"
    priority : "#priority"
    status_open : "#status_open"
    boundingBox : "#boundingBox"
    submitButton : "#submit"

  initialize: (options) ->

    @type = options.type


  ###*
    * Submit form data as json.
    ###
  submit : ->

    # block submit button
    @ui.submitButton.prop("disabled", true)
    @ui.submitButton.addClass("disabled")

    # load form contents into model
    @updateModel()

    # send form data to server
    return @createSubview.submit()


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
    )

    # update models from subviews
    @taskTypeSelectionView.updateModel()
    @teamSelectionView.updateModel()
    @projectSelectionView.updateModel()

    # update model of create-subview
    if @createSubview.updateModel?
      @createSubview.updateModel()

    return


  ###*
   * Toast a success message.
  ###
  showSaveSuccess: ->

    Toast.success("The task was successfully created")

  ###*
   * Toast an error message.
  ###
  showSaveError: ->

    Toast.error("The task could not be created due to server errors.")


  ###*
   * Toast an invalid data message.
  ###
  showInvalidData: ->

    Toast.error("The form data is not correct.")


  ###*
   * Clear all text inputs in the form.
  ###
  clearForm: ->

    debugger
    @ui.form[0].reset()
    # @ui.neededExperience_domain.val("")
    # @ui.neededExperience_value.val("0")
    # @ui.priority.val("0")
    # @ui.status_open.val("10")
    # @ui.boundingBox.val("0, 0, 0, 0, 0, 0")


  ###*
  * Render the SelectionViews based on the stored options.
  * Create a subview based on the passed type: from_form/ from_nml
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

    # get create-subview type
    if @type == "from_form"
      @createSubview = new TaskCreateFromFormView(model: @model, parent: @)
    else if @type == "from_nml"
      @createSubview = new TaskCreateFromNMLView(model: @model, parent: @)
    else
      throw "Type #{@type} is not defined. Choose between \"from_form\" and \"from_nml\"."

    # render the create-subview
    @subview.show(@createSubview)


module.exports = TaskCreateFromView
