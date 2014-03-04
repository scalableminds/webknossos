### define
underscore : _
backbone.marionette : Marionette
###

class CreateProjectModalView extends Backbone.Marionette.CompositeView

  className : "modal hide fade"
  template : _.template("""
    <div class="modal-header">
      <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
      <h3>Create a new Project</h3>
    </div>
    <div class="modal-body">
      <form action="@controllers.admin.routes.ProjectAdministration.create" method="POST" class="form-horizontal">
        <div class=" control-group">
          <label class="control-label" for="team">Team</label>
          <div class="controls">
              <select id="team" name="team">
              </select>
              <span class="help-inline errors"></span>
          </div>
        </div>
        <div class=" control-group">
          <label class="control-label" for="projectName">Project Name</label>
          <div class="controls">
            <input type="text" id="projectName" name="projectName" value="">
            <span class="help-inline errors"></span>
          </div>
        </div>
        <div class=" control-group">
          <label class="control-label" for="owner">Owner</label>
          <div class="controls">
              <select id="owner" name="owner"></select>
              <span class="help-inline errors"></span>
          </div>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <a href="#" class="btn btn-primary">Create</a>
      <a href="#" class="btn"  data-dismiss="modal">Close</a>
    </div>
  """)

  initialize : ->

  show : ->

    @$el.modal("show")