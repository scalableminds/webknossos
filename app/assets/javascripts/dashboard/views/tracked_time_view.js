import _ from "lodash";
import Marionette from "backbone.marionette";

class TrackedTimeView extends Marionette.View {
  static initClass() {
    this.prototype.template = _.template(`\
<h3>Tracked Time</h3>
<table class="table table-striped">
  <thead>
    <tr>
      <th> Month </th>
      <th> Worked </th>
    </tr>
  </thead>
  <tbody>
  <% _.each(formattedLogs, function(entry) { %>
    <tr>
      <td> <%- entry.interval %> </td>
      <td> <%- entry.time %> </td>
    </tr>
  <% }) %>
  </tbody>
</table>\
`);
  }


  initialize() {
    this.listenTo(this.model, "sync", this.render);

    return this.model.fetch();
  }
}
TrackedTimeView.initClass();


export default TrackedTimeView;
