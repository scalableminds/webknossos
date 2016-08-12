_              = require("lodash")
Marionette     = require("backbone.marionette")
Toast          = require("libs/toast")
app            = require("app")
FormSyphon     = require("form-syphon")
SelectionView  = require("admin/views/selection_view")
UserCollection = require("admin/models/user/user_collection")
TeamCollection = require("admin/models/team/team_collection")
ProjectModel   = require("admin/models/project/project_model")

class CreateProjectModalView extends Marionette.LayoutView

  className : "modal fade"
  template : _.template("""
    <div class="modal-dialog">
      <div class="modal-content">
        <form class="form-horizontal">
          <div class="modal-header">
            <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
            <h3>Create a new Project</h3>
          </div>
          <div class="modal-body container-fluid">
            <div class="form-group">
              <label class="col-sm-2" for="team">Team</label>
              <div class="col-sm-10 team">
              </div>
            </div>
            <div class="form-group">
              <label class="col-sm-2 for="name">Project Name</label>
              <div class="col-sm-10">
                <input type="text" class="form-control project-name" name="name" value="" required autofocus>
              </div>
            </div>
            <div class="form-group">
              <label class="col-sm-2 for="owner">Owner</label>
              <div class="col-sm-10 owner">
              </div>
            </div>
            <div class="form-group">
              <label class="col-sm-2 for="priority">Priority</label>
              <div class="col-sm-10">
                <input type="number" class="form-control" name="priority" value="100" required>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="submit" class="btn btn-primary">Create</button>
            <a href="#" class="btn btn-default" data-dismiss="modal">Close</a>
          </div>
        </form>
      </div>
    </div>
  """)

  regions :
    "team" : ".team"
    "owner" : ".owner"

  events :
    "submit form" : "createProject"

  ui :
    "name" : ".project-name"
    "form" : "form"


  initialize : (options) ->

    @projectCollection = options.projectCollection

    @userSelectionView = new SelectionView(
      collection : new UserCollection()
      childViewOptions :
        defaultItem : {email : app.currentUser.email}
        modelValue : -> return @model.id
        modelLabel : -> return "#{@model.get("firstName")} #{@model.get("lastName")} (#{@model.get("email")})"
      name : "owner"
    )
    @teamSelectionView = new SelectionView(
      collection : new TeamCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "amIAnAdmin=true"
      name : "team"
    )


  show : ->

    @$el.modal("show")

    @owner.show(@userSelectionView)
    @team.show(@teamSelectionView)


  createProject : (evt) ->

    evt.preventDefault()

    if @ui.form[0].checkValidity()

      formValues = FormSyphon.serialize(@ui.form)
      project = new ProjectModel(formValues)

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
