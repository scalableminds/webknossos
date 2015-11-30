### define
underscore : _
backbone.marionette : marionette
###

class TeamRoleModalItem extends Backbone.Marionette.ItemView

  tagName : "div"
  className : "row-fluid"
  template : _.template("""
    <div class="col-sm-8">
      <div class="checkbox">
        <label>
          <input data-teamname="<%= name %>" type="checkbox" value="<%= name %>">
            <%= name %>
          </option>
        </label>
      </div>
    </div>
    <div class="col-sm-4">
      <div>
        <select data-teamname="<%= name %>" name="role" class="form-control">
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

