import _ from "lodash";
import Marionette from "backbone.marionette";
import TemplateHelpers from "libs/template_helpers";

class UserListItemView extends Marionette.View {
  static initClass() {
  
    this.prototype.tagName  = "tr";
  
    this.prototype.template  = _.template(`\
<td>
  <input type="checkbox" name="id" value="<%- id %>" class="select-row">
</td>
<td><%- lastName %></td>
<td><%- firstName %></td>
<td><%- email %></td>
<td>
  <% _.each(experiences, function(value, domain){ %>
    <span class="label label-default"><%- domain %> : <%- value %></span>
  <% }) %>
</td>
<td class="no-wrap">
  <% _.each(teams, function(team){ %>
    <%- team.team %>
    <span class="label label-default" style="background-color: <%- TemplateHelpers.stringToColor(team.role.name) %>"><%- team.role.name %></span><br/>
  <% }) %>
</td>
<td class="center-text">
  <% if(isActive) { %>
    <i class="fa fa-check fa-2x"></i><br />
    <a href="#" class="deactivate-user">deactivate</a>
  <% } else { %>
    <i class="fa fa-remove fa-2x"></i><br />
    <a href="#" class="activate-user">activate</a>
  <% } %>
</td>
<td class="nowrap">
  <a href="/users/<%- id %>/details"><i class="fa fa-user"></i>show Tracings</a><br />
  <a href="/api/users/<%- id %>/annotations/download" title="download all finished tracings"><i class="fa fa-download"></i>download </a><br />
  <!--<a href="/admin/users/<%- id %>/loginAs"><i class="fa fa-signin"></i>log in as User </a>-->
</td>\
`);
  
    this.prototype.templateContext  =
      {TemplateHelpers};
  
    this.prototype.events  = {
      "click .activate-user" : "activate",
      "click .deactivate-user" : "deactivate"
    };
  
    this.prototype.modelEvents  =
      {"change" : "render"};
  }
  attributes() {
    return {
      "data-name" : `${this.model.get("firstName")} ${this.model.get("lastName")}`,
      "data-id" : this.model.get("id"),
      "id" : this.model.get("id")
    };
  }

  activate() {

    //select checkbox, so that it gets picked up by the bulk verification modal
    this.$("input").prop("checked", true);

    //HACKY
    return $("#team-role-modal").click();
  }


  deactivate() {

    if (window.confirm("Do you really want to deactivate this user?")) {

      return this.model.save({
        "isActive" : false
      });
    }
  }
}
UserListItemView.initClass();

export default UserListItemView;
