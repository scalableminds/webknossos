### define
underscore : _
backbone.marionette : marionette
###

class TeamRoleModal extends Backbone.Marionette.ItemView

  tagName : "div"
  className : "modal hide fade"
  template : _.template("""
    <div class="modal-header">
      <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
      <h3>Assign teams for this dataset</h3>
    </div>
    <div class="modal-body">
      <ul name="teams" class="modal-team-list">
      </ul>
    </div>
    <div class="modal-footer">
      <a class="btn btn-primary">Save</a>
      <a href="#" class="btn" data-dismiss="modal">Cancel</a>
    </div>
  """)

  events :
    "click .btn-primary" : "changeExperience"

  initalize : ->

  changeExperience : ->

