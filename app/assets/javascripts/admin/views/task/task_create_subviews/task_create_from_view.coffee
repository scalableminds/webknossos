_                       = require("lodash")
Marionette              = require("backbone.marionette")
routes                  = require("routes")
FormSyphon              = require("form-syphon")
TaskTypeCollection      = require("admin/models/tasktype/task_type_collection")
TeamCollection          = require("admin/models/team/team_collection")
ProjectCollection       = require("admin/models/project/project_collection")
SelectionView           = require("admin/views/selection_view")
TaskCreateFromFormView  = require("./task_create_from_form_view")
TaskCreateFromNMLView   = require("./task_create_from_nml_view")
Toast                   = require("libs/toast")
Utils                   = require("libs/utils")

class TaskCreateFromView extends Marionette.View

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
          <h3><%- getActionName() %> Task</h3>
          <br/>
        </div>
        <% } else if (type == "from_nml") { %>
          <h3>Create Task from explorative SkeletonTracing</h3>
          <p>Every nml creates a new task. You can either upload a single NML file or a zipped collection of nml files (.zip).</p>
          <br/>
        </div>
        <% } %>
        <form id="createForm" action="" method="POST" class="form-horizontal" onSubmit="return false;">

        <div class="form-group">
          <label class="col-sm-2 control-label" for="taskType">Task type</label>
          <div class="col-sm-9">
            <div class="taskType"></div>
            <span class="help-block">
              <a href="/taskTypes">Create a new Type</a>
            </span>
          </div>
        </div>

        <div class="form-group">
          <label class="col-sm-2 control-label" for="experience_domain">Experience Domain</label>
          <div class="col-sm-9">
            <input type="text" class="form-control" name="neededExperience[domain]" value="<%- neededExperience.domain %>" placeholder="Enter a domain (min. 3 characters)" pattern=".{3,}" required>
          </div>
        </div>

        <div class="form-group">
          <label class="col-sm-2 control-label" for="experience_value">Min Experience</label>
          <div class="col-sm-9">
            <input type="number" id="value" name="neededExperience[value]" value="<%- neededExperience.value %>" class="form-control" required>
          </div>
        </div>

        <div class="form-group">
          <label class="col-sm-2 control-label" for="status_open"><%- getInstanceLabel() %></label>
          <div class="col-sm-9">
            <input type="number" id="open" name="status[open]" value="<%- status.open %>" min="1" class="form-control" required>
          </div>
        </div>

        <div class="form-group">
          <label class="col-sm-2 control-label" for="team">Team</label>
          <div class="col-sm-9 team">
          </div>
        </div>

        <div class="form-group">
          <label class="col-sm-2 control-label" for="projectName">Project</label>
          <div class="col-sm-9 project">
          </div>
        </div>

        <div class="form-group">
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
              value="<%- boundingBoxString() %>"
              class="form-control"
            >
          </div>
        </div>

        <div class="subview"></div>

        <div class="form-group">
          <div class="col-sm-2 col-sm-offset-9">
            <button id="submit" type="submit" class="form-control btn btn-primary"><%- getActionName() %></button>
          </div>
        </div>

      </form>
    </div>
    </div>
  </div>
  """)

  templateContext: ->

    type : @type
    isEditingMode : @isEditingMode
    getInstanceLabel : => if @isEditingMode then "Remaining Instances" else "Task Instances"
    boundingBoxString : ->
      if not @boundingBox then return ""
      b = @boundingBox
      return "#{b.topLeft.join(', ')}, #{b.width}, #{b.height}, #{b.depth}"


    getActionName : =>
      return @getActionName()


  regions :
    "taskType" : ".taskType"
    "team"     : ".team"
    "project"  : ".project"
    "subview"  : ".subview"

  events :
    "submit" : "submit"

  ui :
    form : "#createForm"
    status_open : "#status_open"
    boundingBox : "#boundingBox"
    submitButton : "#submit"

  initialize : (options) ->

    @type = options.type
    @isEditingMode = _.isString(@model.id)

    if @isEditingMode
      @listenTo(@model, "sync", @render)
      @model.fetch()


  getActionName : ->

    if @isEditingMode
      return "Update"
    else
      return "Create"


  # Submit form data as json
  submit : ->

    @toggleSubmitButton(true)

    # send form data to server
    return @createSubview.submit()


  toggleSubmitButton : (state) ->

    @ui.submitButton.prop("disabled", state)
    @ui.submitButton.toggleClass("disabled", state)


  serializeForm : ->

    formValues = FormSyphon.serialize(@ui.form)

    formValues.status.inProgress = @model.get("status").inProgress
    formValues.status.completed = @model.get("status").completed
    formValues.boundingBox = @parseBoundingBox(formValues.boundingBox)

    return formValues


  parseBoundingBox : (string) ->

      if _.isEmpty(string) then return

      # split string by comma delimiter, trim whitespace and cast to integer
      # access from subview
      intArray = Utils.stringToNumberArray(string)

      return {
        topLeft : [
          intArray[0] || 0,
          intArray[1] || 0,
          intArray[2] || 0
        ],
        width : intArray[3] || 0,
        height : intArray[4] || 0,
        depth : intArray[5] || 0
      }


  showSaveSuccess : (task) ->

    Toast.success("The task was successfully #{@getActionName().toLowerCase()}d")

    url = "/projects/#{task.get("projectName")}/tasks"

    app.router.navigate("#{url}##{task.id}", {trigger : true})


  showSaveError : ->

    @toggleSubmitButton(false)
    Toast.error("The task could not be #{@getActionName().toLowerCase()}d due to server errors.")


  showInvalidData : ->

    Toast.error("The form data is not correct.")


  ###
   Render the SelectionViews based on the stored options.
   Create a subview based on the passed type: from_form/ from_nml
  ###
  onRender : ->

    @taskTypeSelectionView = new SelectionView(
      collection : new TaskTypeCollection()
      childViewOptions :
        modelValue : -> return "#{@model.get("id")}"
        modelLabel : -> return "#{@model.get("summary")}"
        defaultItem : {id : @model.get("type.id") or Utils.getUrlParams("taskType")}
      data : "amIAnAdmin=true"
      name : "taskTypeId"
    )

    @teamSelectionView = new SelectionView(
      collection : new TeamCollection()
      childViewOptions :
        modelValue : -> return "#{@model.get("name")}"
        defaultItem : {name : @model.get("team")}
      data : "amIAnAdmin=true"
      name : "team"
    )

    @projectSelectionView = new SelectionView(
      collection : new ProjectCollection()
      childViewOptions :
        modelValue : -> return "#{@model.get("name")}"
        defaultItem : {name : @model.get("projectName") or Utils.getUrlParams("projectName")}
      data : "amIAnAdmin=true"
      name : "projectName"
      required : true
      emptyOption : true
    )

    # render subviews in defined regions
    @showChildView("taskType", @taskTypeSelectionView)
    @showChildView("team", @teamSelectionView)
    @showChildView("project", @projectSelectionView)

    # get create-subview type
    if @type == "from_form"
      @createSubview = new TaskCreateFromFormView(model : @model, parent : @)
    else if @type == "from_nml"
      @createSubview = new TaskCreateFromNMLView(model : @model, parent : @)
    else
      throw Error("Type #{@type} is not defined. Choose between \"from_form\" and \"from_nml\".")

    # render the create-subview
    @showChildView("subview", @createSubview)


module.exports = TaskCreateFromView
