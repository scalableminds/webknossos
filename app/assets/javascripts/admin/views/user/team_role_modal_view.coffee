### define
underscore : _
backbone.marionette : marionette
admin/models/user/team_collection : TeamCollection
admin/views/user/team_role_modal_item_view : TeamRoleModalItem
###

class TeamRoleModal extends Backbone.Marionette.CompositeView

  tagName : "div"
  className : "modal hide fade"
  template : _.template("""
    <div class="modal-header">
      <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
      <h3>Assign teams for this dataset</h3>
    </div>
    <div class="modal-body">
      <header class="row-fluid">
        <h4 class="span8" for="teams">Teams</h4>
        <h4 class="span4" for="role">Role</h4>
      </header>
      <div id="team-list">
      </div>
    </div>
    <div class="modal-footer">
      <a class="btn btn-primary">Save</a>
      <a href="#" class="btn" data-dismiss="modal">Cancel</a>
    </div>
  """)

  itemView : TeamRoleModalItem
  itemViewContainer : "#team-list"
  events :
    "click .btn-primary" : "changeExperience"


  initialize : ->

    @collection = new TeamCollection()
    @collection.fetch()


  changeExperience : ->

    console.log("click")

