### define
underscore : _
backbone.marionette : marionette
admin/models/user/team_collection : TeamCollection
###

class TeamRoleModalItem extends Backbone.Marionette.ItemView

  tagName : "div"
  className : "row-fluid"
  template : _.template("""
    <div class="span8 checkbox">
      <input type="checkbox" value="<%= name %>"><%= name %></option>
    </div>
    <div class="span4">
      <div>
        <select name="role" class="input-medium">
          <option value="">Modify roles...</option>
            <% _.each(roles, function(role) { %>
              <option value="<%= role.name %>"><%= role.name %></option>
            <% }) %>
        </select>
      </div>
    </div>
  """)
