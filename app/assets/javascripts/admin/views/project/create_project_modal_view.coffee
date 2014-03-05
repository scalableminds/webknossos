### define
underscore : _
backbone.marionette : Marionette
admin/views/selection_view : SelectionView
admin/models/user/user_collection : UserCollection
admin/models/team/team_collection : TeamCollection
###

class CreateProjectModalView extends Backbone.Marionette.Layout

  className : "modal hide fade"
  template : _.template("""
    <div class="modal-header">
      <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
      <h3>Create a new Project</h3>
    </div>
    <div class="modal-body">
      <form action="" method="POST" class="form-horizontal">
        <div class="control-group">
          <label class="control-label" for="team">Team</label>
          <div class="controls team">
          </div>
        </div>
        <div class="control-group">
          <label class="control-label" for="projectName">Project Name</label>
          <div class="controls">
            <input type="text" id="projectName" name="projectName" value="">
          </div>
        </div>
        <div class="control-group">
          <label class="control-label" for="owner">Owner</label>
          <div class="controls owner">
          </div>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <a href="#" class="btn btn-primary">Create</a>
      <a href="#" class="btn"  data-dismiss="modal">Close</a>
    </div>
  """)

  regions :
    "team" : ".team"
    "owner" : ".owner"

  events :
    "submit form" : "cancel"

  initialize : ->

    @userSelectionView = new SelectionView(
      collection : new UserCollection()
      itemViewOptions :
        modelValue : -> return "#{@model.get("firstName")} #{@model.get("lastName")}"
    )
    @teamSelectionView = new SelectionView(
      collection : new TeamCollection()
      itemViewOptions :
        modelValue: -> return "#{@model.get("name")}"
    )


  show : ->

    @$el.modal("show")

    @userSelectionView.render()
    @teamSelectionView.render()

    @owner.show(@userSelectionView)
    @team.show(@teamSelectionView)


  cancel : (evt) ->

    evt.preventDefault()
