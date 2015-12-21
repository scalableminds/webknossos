_              = require("lodash")
Marionette     = require("backbone.marionette")
Toast          = require("libs/toast")
app            = require("app")
SelectionView  = require("admin/views/selection_view")
UserCollection = require("admin/models/user/user_collection")
TeamCollection = require("admin/models/team/team_collection")
ProjectModel   = require("admin/models/project/project_model")

class CreateProjectModalView extends Marionette.LayoutView

  className : "modal fade"
  template : _.template("""
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
          <h3>Create a new Project</h3>
        </div>
        <div class="modal-body container-fluid">
          <form action="" method="POST" class="form-horizontal">
            <div class="form-group">
              <label class="col-sm-2" for="team">Team</label>
              <div class="col-sm-10 team">
              </div>
            </div>
            <div class="form-group">
              <label class="col-sm-2 for="projectName">Project Name</label>
              <div class="col-sm-10">
                <input type="text" class="form-control project-name" name="projectName" value="" required autofocus>
              </div>
            </div>
            <div class="form-group">
              <label class="col-sm-2 for="owner">Owner</label>
              <div class="col-sm-10 owner">
              </div>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <a href="#" class="btn btn-primary create">Create</a>
          <a href="#" class="btn btn-default" data-dismiss="modal">Close</a>
        </div>
      </div>
    </div>
  """)

  regions :
    "team" : ".team"
    "owner" : ".owner"

  events :
    "submit form" : "createProject"
    "click .create" : "createProject"

  ui :
    "name" : ".project-name"
    "team" : ".team"
    "owner" : ".owner"
    "form" : "form"


  initialize : (options) ->

    @projectCollection = options.projectCollection

    @userSelectionView = new SelectionView(
      viewComparator: "firstName"
      collection : new UserCollection()
      childViewOptions :
        modelValue : -> return "#{@model.get("firstName")} #{@model.get("lastName")} (#{@model.get("email")})"
    )
    @teamSelectionView = new SelectionView(
      viewComparator: "name"
      collection : new TeamCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true"
    )


  show : ->

    @$el.modal("show")

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
        success : _.bind(@destroyModal, @)
      )

    else

      @ui.name.focus()


  destroyModal : ->

    # The event is neccesarry due to the 300ms CSS transition
    @$el.on("hidden.bs.modal", =>
      @$el.off("hidden.bs.modal")
      app.vent.trigger("CreateProjectModal:refresh") #update pagination
    )
    @$el.modal("hide")

module.exports = CreateProjectModalView
