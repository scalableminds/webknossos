_              = require("lodash")
app            = require("app")
Marionette     = require("backbone.marionette")
Toast          = require("libs/toast")
TeamModel      = require("admin/models/team/team_model")
TeamCollection = require("admin/models/team/team_collection")
SelectionView  = require("admin/views/selection_view")

class CreateTeamModalView extends Marionette.LayoutView

  className : "modal fade"
  template : _.template("""
    <div class="modal-dialog">
      <div class="modal-content">
        <form class="form-horizontal">
          <div class="modal-header">
            <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
            <h3>Add a New Team</h3>
          </div>
          <div class="modal-body container-fluid">
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
          </div>
          <div class="modal-footer">
            <button type="submit" class="btn btn-primary">Add</button>
            <a href="#" class="btn btn-default" data-dismiss="modal">Close</a>
          </div>
        </form>
      </div>
    </div>
  """)

  ui :
    "inputName" : "#inputName"

  events :
    "submit form" : "addNewTeam"

  regions :
    "parentTeams" : ".parent-teams"

  attributes:
    "tabindex" : "-1"
    "role": "dialog"

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
      success: _.bind(@destroyModal, @)
    )


  show : ->

    @$el.modal("show")
    @parentTeams.show(@teamSelectionView)


  destroyModal : ->

    # The event is neccesarry due to the 300ms CSS transition
    @$el.on("hidden.bs.modal", =>
      @$el.off("hidden.bs.modal")
      app.vent.trigger("CreateTeamModal:refresh") #update pagination
    )
    @$el.modal("hide")

module.exports = CreateTeamModalView
