### define
underscore : _
backbone.marionette : Marionette
libs/toast : Toast
app : app
admin/views/selection_view : SelectionView
admin/models/user/user_collection : UserCollection
admin/models/team/team_collection : TeamCollection
admin/models/project/project_model : ProjectModel
###

class CreateProjectModalView extends Backbone.Marionette.Layout

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
              <label class="col-sm-2 control-label" for="team">Team</label>
              <div class="col-sm-10 team">
              </div>
            </div>
            <div class="form-group">
              <label class="col-sm-2 control-label" for="projectName">Project Name</label>
              <div class="col-sm-10">
                <input type="text" class="form-control project-name" name="projectName" value="" required autofocus>
              </div>
            </div>
            <div class="form-group">
              <label class="col-sm-2 control-label" for="owner">Owner</label>
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
      collection : new UserCollection()
      itemViewOptions :
        modelValue : -> return "#{@model.get("firstName")} #{@model.get("lastName")}"
    )
    @teamSelectionView = new SelectionView(
      collection : new TeamCollection()
      itemViewOptions :
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
        error : @handleXHRError
        success : -> app.vent.trigger("CreateProjectModal:refresh") #update pagination
      )


      @$el.modal("hide")

    else

      @ui.name.focus()


  handleXHRError : (model, xhr) ->

    xhr.responseJSON.messages.forEach(
      (message) ->
        Toast.error(message.error)
    )
