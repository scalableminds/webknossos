### define
underscore : _
backbone.marionette : marionette
admin/models/team/team_collection : TeamCollection
###

class TeamRoleModalItem extends Backbone.Marionette.ItemView

  tagName : "div"
  className : "row-fluid"
  template : _.template("""
    <div class="col-sm-8">
      <div class="checkbox">
        <label>
          <input type="checkbox" value="<%= name %>"><%= name %></option>
        </label>
      </div>
    </div>
    <div class="col-sm-4">
      <div>
        <select name="role" class="form-control">
          <option value="">Modify roles...</option>
            <% _.each(roles, function(role) { %>
              <option value="<%= role.name %>"><%= role.name %></option>
            <% }) %>
        </select>
      </div>
    </div>
  """)

  events :
    "change @ui.roleSelect" : "selectionChanged"

  ui :
    "teamCheckbox" : "input[type=checkbox]"
    "roleSelect" : "select"


  selectionChanged : ->

    @ui.teamCheckbox.prop("checked", true)

