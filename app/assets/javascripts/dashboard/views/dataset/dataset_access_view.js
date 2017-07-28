/**
 * dataset_access_view.js
 * @flow weak
 */

import _ from "lodash";
import Marionette from "backbone.marionette";
import TemplateHelpers from "libs/template_helpers";

class DatasetAccessView extends Marionette.View {
  static initClass() {
    this.prototype.tagName = "tr";

    this.prototype.template = _.template(`\
<td><%- firstName %> <%- lastName %></td>
<td>
  <% teams.forEach(function(team){ %>
    <span class="label label-default" style="background-color: <%- TemplateHelpers.stringToColor(team.team) %>"><%- team.team %></span>
  <% }) %>
</td>\
`);

    this.prototype.templateContext = { TemplateHelpers };
  }
}
DatasetAccessView.initClass();

export default DatasetAccessView;
