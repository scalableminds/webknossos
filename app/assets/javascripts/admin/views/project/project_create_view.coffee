_              = require("lodash")
app            = require("app")
FormSyphon     = require("form-syphon")
Marionette     = require("backbone.marionette")
UserCollection = require("admin/models/user/user_collection")
TeamCollection = require("admin/models/team/team_collection")
SelectionView  = require("admin/views/selection_view")
ProjectModel   = require("admin/models/project/project_model")
Toast          = require("libs/toast")

class ProjectCreateView extends Marionette.View

  template : _.template("""
    <div class="row">
      <div class="col-sm-12">
        <div class="well">
          <div class="col-sm-9 col-sm-offset-2">
            <h3>Create Project</h3>
          </div>

          <form method="POST" class="form-horizontal">
            <div class="form-group">
              <label class="col-sm-2 control-label" for="name">Project Name</label>
              <div class="col-sm-9">
              <input type="text" id="name" name="name" value="" class="form-control"
                 required pattern=".{3,100}" title="Please use at least 3 and max 100 characters ." autofocus>
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-2 control-label" for="team">Team</label>
              <div class="col-sm-9 team">
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-2 control-label" for="owner">Owner</label>
              <div class="col-sm-9 owner">
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-2 control-label" for="priority">Priority</label>
              <div class="col-sm-9">
                <input type="number" class="form-control" name="priority" value="100" required>
              </div>
            </div>

            <div class="form-group">
              <label class="col-sm-2 control-label">Project Type</label>
              <div class="col-sm-9">
                <label class="radio-inline">
                  <input type="radio" name="assignmentConfiguration[location]" value="webknossos" checked />
                    webKnossos
                </label>
                <label class="radio-inline">
                  <input type="radio" name="assignmentConfiguration[location]" value="mturk" />
                    Mechanical Turk
                </label>
              </div>
            </div>

            <div class="mturk-settings">
              <h4>Mechanical Turk settings</h4>

              <div class="form-group">
                <label class="col-sm-2 control-label" for="requiredQualification">Required qualification</label>
                <div class="col-sm-9">
                  <select class="form-control" name="assignmentConfiguration[requiredQualification]" disabled>
                    <option value="mt-everyone" selected>None</option>
                    <option value="mt-expert">Expert</option>
                    <option value="mpi-branchpoint">MPI Branchpoint</option>
                    <option value="mt-max-10k-hits">Worker with less than 10k approved HITs</option>
                    <option value="mt-min-10k-hits">Worker with more than 10k approved HITs</option>
                  </select>
                </div>
              </div>

              <div class="form-group">
                <label class="col-sm-2 control-label" for="assignmentDurationInSeconds">Assignment duration in seconds</label>
                <div class="col-sm-9">
                  <input type="number" class="form-control" name="assignmentConfiguration[assignmentDurationInSeconds]" value="3600" disabled required>
                </div>
              </div>

              <div class="form-group">
                <label class="col-sm-2 control-label" for="rewardInDollar">Reward in USD</label>
                <div class="col-sm-9">
                  <input type="number" class="form-control" name="assignmentConfiguration[rewardInDollar]" value="0.05" step="0.01" disabled required>
                </div>
              </div>

              <div class="form-group">
                <label class="col-sm-2 control-label" for="autoApprovalDelayInSeconds">Auto approval delay in seconds</label>
                <div class="col-sm-9">
                  <input type="number" class="form-control" name="assignmentConfiguration[autoApprovalDelayInSeconds]" value="60000" disabled required>
                </div>
              </div>

              <div class="form-group">
                <label class="col-sm-2 control-label" for="template">HIT Template</label>
                <div class="col-sm-9">
                  <select class="form-control" name="assignmentConfiguration[template]" disabled>
                    <option value="default_template" selected>Default flight template</option>
                    <option value="branchpoint_template">Branchpoint template</option>
                  </select>
                </div>
              </div>

              <div class="form-group">
                <label class="col-sm-2 control-label" for="title">Title</label>
                <div class="col-sm-9">
                  <input type="text" class="form-control" name="assignmentConfiguration[title]" disabled required>
                </div>
              </div>

              <div class="form-group">
                <label class="col-sm-2 control-label" for="keywords">Keywords (comma separated)</label>
                <div class="col-sm-9">
                  <input type="text" class="form-control" name="assignmentConfiguration[keywords]" disabled required>
                </div>
              </div>

              <div class="form-group">
                <label class="col-sm-2 control-label" for="description">Description</label>
                <div class="col-sm-9">
                  <textarea class="form-control" name="assignmentConfiguration[description]" disabled required rows="3"></textarea>
                </div>
              </div>

            <div class="form-group">
              <div class="col-sm-2 col-sm-offset-9">
              <button type="submit" class="form-control btn btn-primary">Create Project</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  """)
  className : "container wide project-administration"

  footerTemplate : """
    <button type="submit" class="btn btn-primary">Create</button>
    <a href="#" class="btn btn-default" data-dismiss="modal">Close</a>
  """


  regions :
    "team" : ".team"
    "owner" : ".owner"

  events :
    "submit form" : "createProject"
    "change @ui.projectTypeInput" : "changeProjectType"

  ui :
    "name" : ".project-name"
    "form" : "form"
    "projectTypeInput" : "[name='assignmentConfiguration[location]']"
    "mturkSettingsInputs" : ".mturk-settings input, .mturk-settings textarea, .mturk-settings select"


  initialize : ->

    @model._isNew = true

    @userSelectionView = new SelectionView(
      collection : new UserCollection()
      childViewOptions :
        defaultItem : {email : app.currentUser.email}
        modelValue : -> return @model.id
        modelLabel : -> return "#{@model.get("firstName")} #{@model.get("lastName")} (#{@model.get("email")})"
      name : "owner"
      data : "isAdmin=true"
    )
    @teamSelectionView = new SelectionView(
      collection : new TeamCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true"
      name : "team"
    )


  changeProjectType: ->

    projectType = @ui.projectTypeInput.filter(":checked").val()
    if projectType == "mturk"
      @ui.mturkSettingsInputs.prop("disabled", false)
    else
      @ui.mturkSettingsInputs.prop("disabled", true)


  onRender : ->

    @showChildView("owner", @userSelectionView)
    @showChildView("team", @teamSelectionView)


  createProject : (evt) ->

    evt.preventDefault()

    if @ui.form[0].checkValidity()

      formValues = FormSyphon.serialize(@ui.form)
      @model.save(formValues).then(
        -> app.router.navigate("/projects", { trigger: true })
      )

    else

      @ui.name.focus()


module.exports = ProjectCreateView
