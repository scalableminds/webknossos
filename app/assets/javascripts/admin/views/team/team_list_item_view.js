import _ from "lodash";
import Marionette from "backbone.marionette";
import TemplateHelpers from "libs/template_helpers";

class TeamListItemView extends Marionette.View {
  static initClass() {
    this.prototype.tagName = "tr";
    this.prototype.template = _.template(`\
<td><%- name %></td>
<td><% if(parent){ %><%- parent %><% } %></td>
<td><% if(owner){ %> <%- owner.firstName %> <%- owner.lastName %> (<%- owner.email %>)<% }else{ %> - <% } %></td>
<td>
  <% _.each(roles, function(role){ %>
      <span class="label label-default" style="background-color: <%- TemplateHelpers.stringToColor(role.name) %>"><%- role.name %></span>
  <% }) %>
</td>
</td>
<td class="nowrap">
  <% if(amIOwner){ %>
    <a href="#" class="delete"><i class="fa fa-trash-o"></i>delete</a>
  <% } %>
</td>\
`);

    this.prototype.templateContext =
      { TemplateHelpers };

    this.prototype.events =
      { "click .delete": "delete" };

    this.prototype.modelEvents =
      { change: "render" };
  }


  delete(evt) {
    evt.preventDefault();
    if (window.confirm("Do really want to delete this team?")) {
      this.model.destroy();
    }
  }
}
TeamListItemView.initClass();


export default TeamListItemView;
