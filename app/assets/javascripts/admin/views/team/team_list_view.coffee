### define
underscore : _
backbone.marionette : marionette
libs/toast : Toast
app : app
./team_list_item_view : TeamListItemView
admin/models/team/team_collection : TeamCollection
admin/models/team/team_model : TeamModel
###

class TeamListView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <h3>Teams</h3>
    <form method="post">
      <table class="table table-striped">
        <thead>
          <tr>
            <th><input type="checkbox" class="select-all-rows"> </th>
            <th>Name</th>
            <th>Owner</th>
            <th>Roles</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
      <div class="form-actions navbar-fixed-bottom">
        <div class="btn-group">
          <a class="btn btn-primary" id="new-team">
            <i class="fa fa-plus"></i>Add New Team
          </a>
        </div>
      </div>
    </form>
    <div class="modal hide fade">
      <div class="modal-header">
        <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
        <h3>Add a New Team</h3>
      </div>
      <div class="modal-body">
        <form class="form-horizontal">
          <div class="control-group">
            <label class="control-label" for="inputName">Name</label>
            <div class="controls">
              <input type="text" id="inputName" placeholder="Name" required autofocus>
            </div>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <a href="#" class="btn btn-primary" data-dismiss="modal">Add</a>
        <a href="#" class="btn" data-dismiss="modal">Close</a>
      </div>
    </div>
  """)
  className : "team-administration container wide"
  itemView : TeamListItemView
  itemViewContainer : "tbody"

  ui :
    "modal" : ".modal"
    "inputName" : "#inputName"

  events :
    "click #new-team" : "showModal"
    "click .modal .btn-primary" : "addNewTeam"

  initialize : ->

    @listenTo(app.vent, "paginationView:filter", @filter)

    @collection.fetch(
      data : "isEditable=true"
      silent : true
    ).done( =>
      @collection.goTo(1)
    )


  addNewTeam : ->

    team = new TeamModel(
      name : @ui.inputName.val(),
    )
    @collection.create(team, {wait: true})


  filter : (filterQuery) ->

    @collection.setFilter(["name", "owner"], filterQuery)
    @collection.pager()


  showModal : (modalView) ->

    @ui.inputName.val("")
    @ui.modal.modal("show")
