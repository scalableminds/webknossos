_                   = require("lodash")
app                 = require("app")
Marionette          = require("backbone.marionette")
Toast               = require("libs/toast")
SelectAllRows       = require("libs/behaviors/select_all_rows_behavior")
TeamRoleModalView   = require("admin/views/user/team_role_modal_view")
ExperienceModalView = require("admin/views/user/experience_modal_view")
UserListItemView    = require("./user_list_item_view")

class UserListView extends Marionette.CompositeView

  template : _.template("""
    <h3>Users</h3>
    <table class="table table-striped">
      <thead>
        <tr>
          <th>
            <input type="checkbox" class="select-all-rows">
          </th>
          <th>Last name</th>
          <th>First name</th>
          <th>Email</th>
          <th>Experiences</th>
          <th>Teams - Role</th>
          <th id="status-column">Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>

    <div class="navbar navbar-default navbar-fixed-bottom">
      <div class="navbar-form">
        <div class="btn-group">
          <a class="btn btn-default" id="team-role-modal">
            <i class="fa fa-group"></i>Edit Teams
          </a>
          <a class="btn btn-default" id="experience-modal">
            <i class="fa fa-trophy"></i>Change Experience
          </a>
        </div>
      </div>
    </div>
    <div id="modal-wrapper"></div>
  """)
  className : "user-administration-table container wide"
  childView : UserListItemView
  childViewContainer : "tbody"

  ui :
    "modalWrapper" : "#modal-wrapper"

  events :
    "click #team-role-modal" : "showTeamRoleModal"
    "click #experience-modal" : "showExperienceModal"

  behaviors:
    SelectAllRows :
      behaviorClass : SelectAllRows

  initialize : ->

    @collection.setPageSize(50)
    @collection.fetch(
      data : "isEditable=true"
    )

    @listenTo(app.vent, "paginationView:filter", @filterBySearch)


  filterBySearch : (filterQuery) ->

    @collection.setFilter(["email", "firstName",  "id", "lastName"], filterQuery)


  showTeamRoleModal : ->

    @showModal(TeamRoleModalView)


  showExperienceModal : ->

    @showModal(ExperienceModalView)


  showModal : (modalView) ->

    if @$("tbody input[type=checkbox]:checked").length > 0
      modalView = new modalView({userCollection : @collection})
      modalView.render()
      @ui.modalWrapper.html(modalView.el)

      modalView.$el.modal("show")
      @modalView = modalView

    else
      Toast.error("No user is selected.")


  onDestroy : ->

    @modalView?.destroy()

module.exports = UserListView
