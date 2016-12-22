_              = require("lodash")
app            = require("app")
Marionette     = require("backbone.marionette")
Toast          = require("libs/toast")
TeamModel      = require("admin/models/team/team_model")
TeamCollection = require("admin/models/team/team_collection")
SelectionView  = require("admin/views/selection_view")
ModalView      = require("admin/views/modal_view")


class CreateTeamModalView extends ModalView

  headerTemplate : "<h3>Add a New Team</h3>"
  bodyTemplate : _.template("""
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
          <input type="text" class="form-control" id="" placeholder="Name" required>
        </div>
      </div>
    </form>
  """)
  footerTemplate : """
    <button type="submit" class="btn btn-primary">Add</button>
    <a href="#" class="btn btn-default" data-dismiss="modal">Close</a>
  """

  ui :
    "inputName" : "#inputName"

  events :
    "submit form" : "addNewTeam"
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


  addNewTeam : (evt) ->

    evt.preventDefault()

    team = new TeamModel(
      name : @ui.inputName.val(),
      parent : @$("select :selected").val()
    )
    @teamCollection.create(team,
      wait: true
      success: _.bind(@destroy, @)
    )


  onRender : ->

    @showChildView("parentTeams", @teamSelectionView)


module.exports = CreateTeamModalView
