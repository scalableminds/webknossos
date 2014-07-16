### define
underscore : _
app : app
libs/toast : Toast
admin/models/team/team_model : TeamModel
admin/models/team/team_collection : TeamCollection
admin/views/selection_view : SelectionView
###

class CreateTeamModalView extends Backbone.Marionette.LayoutView

  className : "modal fade"
  template : _.template("""
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
          <h3>Add a New Team</h3>
        </div>
        <div class="modal-body container-fluid">
          <form class="form-horizontal">
            <div class="form-group">
              <label class="col-sm-2 control-label" for="inputName">Name</label>
              <div class="col-sm-10">
                <input type="text" class="form-control" id="inputName" placeholder="Name" required autofocus>
              </div>
            </div>
            <div class="form-group">
              <label class="col-sm-2 control-label" for="inputName">Parent Team</label>
              <div class="col-sm-10 parent-teams">
                <input type="text" class="form-control" id="" placeholder="Name" required autofocus>
              </div>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <a href="#" class="btn btn-primary">Add</a>
          <a href="#" class="btn btn-default" data-dismiss="modal">Close</a>
        </div>
      </div>
    </div>
  """)

  ui :
    "inputName" : "#inputName"

  events :
    "click .btn-primary" : "addNewTeam"

  regions :
    "parentTeams" : ".parent-teams"


  initialize : (options) ->

    @teamCollection = options.teamCollection

    @teamSelectionView = new SelectionView(
      collection : new TeamCollection()
      childViewOptions :
        modelValue: -> return "#{@model.get("name")}"
      data : "isRoot=true"
    )


  addNewTeam : ->

    team = new TeamModel(
      name : @ui.inputName.val(),
      parent : @$("select :selected").val()
    )
    @teamCollection.create(team,
      wait: true
      error : (model, xhr) -> Toast.message(xhr.responseJSON.messages)
      success: _.bind(@destroyModal, @)
    )


  show : ->

    @$el.modal("show")
    @parentTeams.show(@teamSelectionView)


  destroyModal : ->

    # The event is neccesarry due to the 300ms CSS transition
    @$el.on("hide.bs.modal", =>
      @$el.off("hide.bs.modal")
      app.vent.trigger("CreateTeamModal:refresh") #update pagination
    )
    @$el.modal("hide")

