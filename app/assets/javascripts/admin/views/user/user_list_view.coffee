### define
underscore : _
backbone.marionette : marionette
./user_list_item_view : UserListItemView
admin/models/user/user_collection : UserCollection
admin/views/user/team_role_modal_view : TeamRoleModalView
admin/views/user/bulk_delete_modal_view : BulkDeleteModalView
admin/views/user/experience_modal_view : ExperienceModalView
###

class UserListView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <h3> Users </h3>
    <form method="post">
      <table class="table table-striped">
        <thead>
          <tr>
            <th> <input type="checkbox" class="select-all-rows"> </th>
            <th> Last name </th>
            <th> First name </th>
            <th> Email </th>
            <th> Experiences </th>
            <th> Teams - Role</th>
            <th> Verified </th>
            <th></th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>

      <div class="form-actions navbar-fixed-bottom">
        <div class="btn-group dropup">
          <a class="btn dropdown-toggle" data-toggle="dropdown" href="#">
            Bulk Actions
            <span class="caret"></span>
          </a>
          <ul class="dropdown-menu">
            <li>
              <a id="team-role-modal">
                <i class="icon-ok"></i> Verify
              </a>
            </li>
            <li>
              <a id="bulk-delete-modal">
                <i class="icon-trash"></i> Delete
              </a>
            </li>
            <li>
              <a id="experience-modal">
                <i class="icon-trophy"></i> Change Experience
              </a>
            </li>
          </ul>
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

    @collection = new UserCollection()
    @collection.fetch()


  showTeamRoleModal : ->

    @showModal(TeamRoleModalView)


  showBulkDeleteModal : ->

    @showModal(BulkDeleteModalView)


  showExperienceModal : ->

    @showModal(ExperienceModalView)


  showModal : (modalView) ->

    view = new modalView({collection: @collection})
    view.render()
    @ui.modalWrapper.html(view.el)

    view.$el.modal("show")


