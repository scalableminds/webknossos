### define
underscore : _
app : app
backbone.marionette : marionette
libs/toast : Toast
./user_list_item_view : UserListItemView
admin/views/user/team_role_modal_view : TeamRoleModalView
admin/views/user/bulk_delete_modal_view : BulkDeleteModalView
admin/views/user/experience_modal_view : ExperienceModalView
###

class UserListView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <h3>Users</h3>
    <form method="post">
      <table class="table table-striped">
        <thead>
          <tr>
            <th><input type="checkbox" class="select-all-rows"> </th>
            <th>Last name</th>
            <th>First name</th>
            <th>Email</th>
            <th>Experiences</th>
            <th>Teams - Role</th>
            <th>Verified</th>
            <th></th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>

      <div class="form-actions navbar-fixed-bottom">
        <div class="btn-group">
          <a class="btn" id="team-role-modal">
            <i class="fa fa-group"></i>Edit Teams
          </a>
          <a class="btn" id="bulk-delete-modal">
            <i class="fa fa-trash-o"></i>Delete
          </a>
          <a class="btn" id="experience-modal">
            <i class="fa fa-trophy"></i>Change Experience
          </a>
        </div>
      </div>
    </form>
    <div id="modal-wrapper"></div>
  """)
  className : "user-administration-table container wide"
  itemView : UserListItemView
  itemViewContainer : "tbody"

  ui :
    "modalWrapper" : "#modal-wrapper"

  events :
    "click #team-role-modal" : "showTeamRoleModal"
    "click #bulk-delete-modal" : "showBulkDeleteModal"
    "click #experience-modal" : "showExperienceModal"


  initialize : ->

    @collection.fetch(
      data : "isEditable=true"
      silent : true
    ).done( =>
      @collection.goTo(1)
    )

    @listenTo(app.vent, "paginationView:filter", @filter)


  filter : (filterQuery) ->

    @collection.setFilter(["email", "firstName", "lastName"], filterQuery)
    @collection.pager()


  showTeamRoleModal : ->

    @showModal(TeamRoleModalView)


  showBulkDeleteModal : ->

    @showModal(BulkDeleteModalView)


  showExperienceModal : ->

    @showModal(ExperienceModalView)


  showModal : (modalView) ->

    if @$("input[type=checkbox]:checked").length > 0
      modalView = new modalView({userCollection : @collection})
      modalView.render()
      @ui.modalWrapper.html(modalView.el)

      modalView.$el.modal("show")
      @modalView = modalView

    else
      Toast.error("No user is selected.")


  onClose : ->

    @modalView?.close()

