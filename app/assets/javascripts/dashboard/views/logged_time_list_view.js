/**
 * logged_time_list_view.js
 * @flow weak
 */

import _ from "lodash";
import Marionette from "backbone.marionette";
import moment from "moment";
import FormatUtils from "libs/format_utils";

class LoggedTimeListView extends Marionette.View {
  static initClass() {
    this.prototype.template = _.template(`\
<table class="table-striped table-hover table">
  <thead>
    <tr>
      <th>Month</th>
      <th>Worked Hours</th>
    </tr>
  </thead>
  <tbody>
    <% items.forEach(function(item) { %>
      <tr>
        <td><%- moment(item.interval).format("MM/YYYY") %></td>
        <td><%- FormatUtils.formatSeconds(item.time.asSeconds()) %></td>
      </tr>
    <% }) %>
  </tbody>
</table>\
`);

    this.prototype.templateContext = {
      FormatUtils,
      moment,
    };
  }
}
LoggedTimeListView.initClass();

export default LoggedTimeListView;

