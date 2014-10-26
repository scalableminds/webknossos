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
###

class TaskCreateFromView extends Backbone.Marionette.LayoutView

  constructor: (type) ->
    super
    @isFromForm = type == "from_form"

  id : "create-from"
  template : _.template("""
  <div class="row">
    <div class="col-sm-12">
    <div class="well">
      <div class="col-sm-9 col-sm-offset-2">
        <% if(isFromForm) { %>
          <h3>Create Task</h3>
          <br/>
        <% } else { %>
          <h3>Create Task from explorative SkeletonTracing</h3>
          <p>Every nml creates a new task. You can either upload a single NML file or a zipped collection of nml files (.zip).</p>
          <br/>
        <% } %>
      </div>
      <form action="/admin/tasks/createFromForm" method="POST" class="form-horizontal">

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
          <label class="col-sm-2 control-label" for="taskInstances">Task instances</label>
          <div class="col-sm-9">
            <input type="number" id="taskInstances" name="taskInstances" value="10" min="1" class="form-control">
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

        <div class="subview">

        </div>

        <div class="form-group">
          <div class="col-sm-2 col-sm-offset-9">
            <button type="submit" class="form-control btn btn-primary">Create</button>
          </div>
        </div>

      </form>
    </div>
    </div>
  </div>
  """)

  # make the variable available inside the underscore template
  templateHelpers: ->

    isFromForm : @isFromForm

  regions:
    "taskType" : ".taskType"
    "team"     : ".team"
    "project"  : ".project"
    "subview"  : ".subview"

  #events :
  # put submit event here


  ###*
    * Submit form data as json.
    *
    * @method submit
    ###
#  submit : ->

  # trigger ajax

  ###*
  * Render the SelectionViews based on the stored options
  * creates a subview based on the passed type: from_form / from_nml
  *
  * @method onRender
  ###
  onRender: ->

    taskTypeSelectionView = new SelectionView(
      collection: new TaskTypeCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("summary")}"
      data : "amIAnAdmin=true"
      name: "taskType"
    )

    teamSelectionView = new SelectionView(
      collection : new TeamCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true"
      name: "team"
    )

    projectSelectionView = new SelectionView(
      collection: new ProjectCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true"
      name: "project"
    )

    @taskType.show(taskTypeSelectionView)
    @team.show(teamSelectionView)
    @project.show(projectSelectionView)

    if (@isFromForm)
      createFromNMLView = new TaskCreateFromNMLView()
      @subview.show(createFromNMLView)
    else
      createFromFormView = new TaskCreateFromFormView()
      @subview.show(createFromFormView)




