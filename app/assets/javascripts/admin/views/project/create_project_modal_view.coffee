### define
underscore : _
backbone.marionette : Marionette
admin/views/selection_view : SelectionView
admin/models/user/user_collection : UserCollection
admin/models/team/team_collection : TeamCollection
admin/models/project/project_model : ProjectModel
###

class CreateProjectModalView extends Backbone.Marionette.Layout

  className : "modal hide fade"
  template : _.template("""
    <div class="modal-header">
      <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
      <h3>Create a new Project</h3>
    </div>
    <div class="modal-body">
      <form action="" method="POST" class="form-horizontal">
        <div class="control-group">
          <label class="control-label" for="team">Team</label>
          <div class="controls team">
          </div>
        </div>
        <div class="control-group">
          <label class="control-label" for="projectName">Project Name</label>
          <div class="controls">
            <input type="text" class="project-name" name="projectName" value="" required autofocus>
          </div>
        </div>
        <div class="control-group">
          <label class="control-label" for="owner">Owner</label>
          <div class="controls owner">
          </div>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <a href="#" class="btn btn-primary create">Create</a>
      <a href="#" class="btn" data-dismiss="modal">Close</a>
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
      collection : new UserCollection()
      itemViewOptions :
        modelValue : -> return "#{@model.get("firstName")} #{@model.get("lastName")}"
    )
    @teamSelectionView = new SelectionView(
      collection : new TeamCollection()
      itemViewOptions :
        modelValue: -> return "#{@model.get("name")}"
    )


  show : ->

    @$el.modal("show")

    @userSelectionView.render()
    @teamSelectionView.render()

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
      @projectCollection.create(project, {wait : true})

      @$el.modal("hide")

    else

      @ui.name.focus()


