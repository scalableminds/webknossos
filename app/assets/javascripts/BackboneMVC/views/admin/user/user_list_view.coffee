### define
underscore : _
backbone.marionette : marionette
./user_list_item_view : UserListItemView
backboneMVC/models/admin/user/user_collection : UserCollection
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
              <a data-template="teampicker" class="show-modal">
                <i class="icon-ok"></i> Verify
              </a>
            </li>
            <li>
              <a data-template="deletepicker"  class="show-modal">
                <i class="icon-trash"></i> Delete
              </a>
            </li>
            <li>
              <a data-template="experiencepicker"  class="show-modal">
                <i class="icon-trophy"></i> Change Experience
              </a>
            </li>
          </ul>
        </div>

        </div>
        <div class="modal hide fade">
          <div class="modal-header">
              <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
              <h3></h3>
          </div>
          <div class="modal-body">
          </div>
        </div>
      </form>
    </div>
  """)
  className : "user-administration-table container wide"
  itemView : UserListItemView
  itemViewContainer : "tbody"
  ui :
    bulkActionButtons : ".show-modal"

  events :
    "click .show-modal" : "showModal"

  initialize : ->

    @collection = new UserCollection()
    @collection.fetch()


  showModal : ->




