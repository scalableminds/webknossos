### define
underscore : _
backbone.marionette : marionette
libs/toast : Toast
./team_list_item_view : TeamListItemView
admin/models/user/team_collection : TeamCollection
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
            <th></th>
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
    <div id="modal-wrapper"></div>
  """)
  className : "team-administration container wide"
  itemView : TeamListItemView
  itemViewContainer : "tbody"

  ui :
    "modalWrapper" : "#modal-wrapper"

  events :
    "click #new-team" : "addNewTeam"

  initialize : ->

    @collection = new TeamCollection()
    @collection.fetch(
      data:
        isEditable: true
    )

    #fetch the user's name
    @user = $.ajax(
      url: "/api/user"
    )

  addNewTeam : ->

    @user.then(
      (userData) =>
        team =
          name : "test"
          owner : "#{userData.firstName} #{userData.lastName}"
          roles : [{ name : "admin" }, { name : "user" }]
          isEditable : true

        @collection.create(team)
      ->
        Toast.error("Ups. Something went wrong")
    )


  showModal : (modalView) ->

    if @$el.find("input[type=checkbox]:checked").length > 0
      view = new modalView({userCollection : @collection})
      view.render()
      @ui.modalWrapper.html(view.el)

      view.$el.modal("show")

    else
      Toast.error("No user is selected.")
