import _ from "lodash";
import Marionette from "backbone.marionette";
import TemplateHelpers from "libs/template_helpers";

class WorkloadListItemView extends Marionette.View {
  static initClass() {
    this.prototype.tagName = "tr";
    this.prototype.template = _.template(`\
<td><%- name %></td>
<td>
  <% _.each(teams.sort(), function(team){ %>
      <span class="label label-default" style="background-color: <%- TemplateHelpers.stringToColor(team) %>"><%- team %></span>
  <% }) %>
</td>
<td><%- projects.join(", ") %></td>
<td><%- availableTaskCount %></td>\
`);

    this.prototype.templateContext = { TemplateHelpers };
  }
}
WorkloadListItemView.initClass();

export default WorkloadListItemView;
