_              = require("lodash")
Marionette     = require("backbone.marionette")
Toast          = require("libs/toast")
app            = require("app")
SelectionView  = require("admin/views/selection_view")
UserCollection = require("admin/models/user/user_collection")
TeamCollection = require("admin/models/team/team_collection")
ProjectModel   = require("admin/models/project/project_model")
ModalView      = require("admin/views/modal_view")

class CreateProjectModalView extends ModalView

  headerTemplate : "<h3>Create a new Project</h3>"
  bodyTemplate : _.template("""
    <form class="form-horizontal">
      <div class="form-group">
        <label class="col-sm-2 for="projectName">Project Name</label>
        <div class="col-sm-10">
          <input type="text" class="form-control project-name" name="projectName" value="" required autofocus>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-2" for="team">Team</label>
        <div class="col-sm-10 team">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-2 for="owner">Owner</label>
        <div class="col-sm-10 owner">
        </div>
      </div>
    </form>
  """)

  footerTemplate : """
    <button type="submit" class="btn btn-primary">Create</button>
    <a href="#" class="btn btn-default" data-dismiss="modal">Close</a>
  """


  regions :
    "team" : ".team"
    "owner" : ".owner"

  events :
    "submit form" : "createProject"
    "click button[type=submit]" : "createProject"

  ui :
    "name" : ".project-name"
    "team" : ".team"
    "owner" : ".owner"
    "form" : "form"


  initialize : (options) ->

    @projectCollection = options.projectCollection

    @userSelectionView = new SelectionView(
      collection : new UserCollection()
      childViewOptions :
        defaultItem : {email : app.currentUser.email}
        modelValue : -> return "#{@model.get("firstName")} #{@model.get("lastName")} (#{@model.get("email")})"
      data : "isAdmin=true"
    )
    @teamSelectionView = new SelectionView(
      collection : new TeamCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true"
    )


  onRender : ->

    @owner.show(@userSelectionView)
    @team.show(@teamSelectionView)


  createProject : (evt) ->

    evt.preventDefault()

    if @ui.form[0].checkValidity()

      project = new ProjectModel(
        owner : @ui.owner.find("select :selected").attr("id")
        name : @ui.name.val()
        team : @ui.team.find("select :selected").val()
      )

      @projectCollection.create(project,
        wait : true
        success : _.bind(@destroy, @)
      )

    else

      @ui.name.focus()


module.exports = CreateProjectModalView
