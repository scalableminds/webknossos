import _ from "lodash";
import Marionette from "backbone.marionette";
import Request from "libs/request";
import moment from "moment";

class DashboardTaskListItemView extends Marionette.View {
  static initClass() {
    this.prototype.tagName = "tr";

    this.prototype.template = _.template(`\
<td>
  <div class="monospace-id">
    <%- id %>
  </div>
</td>
<td><%- type.summary      %></td>
<td><%- projectName       %></td>
<td><%- type.description  %></td>
<td>
  <% _.each(type.settings.allowedModes, function(mode) { %>
    <span class="label-default label">
      <%- mode %>
    </span>
  <% }) %>
</td>
<td><%- moment(created).format("YYYY-MM-DD HH:SS") %></td>
<td class="nowrap">
  <% if (annotation.state.isFinished) { %>
    <i class="fa fa-check"></i><span> Finished</span><br />
  <% } else { %>
    <a href="/annotations/<%- annotation.typ %>/<%- annotation.id %>">
      <i class="fa fa-random"></i>
      <strong>trace</strong>
    </a>
    <% if (isAdminView) { %>
      <br/>
      <a href="/annotations/<%- annotation.typ %>/<%- annotation.id %>/transfer" id="transfer-task">
        <i class="fa fa-share"></i>
        transfer
      </a>
      </br>
      <a href="#" id="cancel-task">
        <i class="fa fa-trash-o"></i>
        cancel
      </a>
    <% } %>
    <br/>
    <a href="#" id="finish-task" class="trace-finish">
      <i class="fa fa-check-circle-o"></i>
      finish
    </a>
  <% } %>
</td>\
`);

    this.prototype.templateContext =
      { moment };

    this.prototype.events = {
      "click #finish-task": "finish",
      "click #cancel-task": "cancelAnnotation",
    };
  }


  className() {
    if (this.model.get("annotation.state.isFinished")) {
      return "finished";
    }
    return "unfinished";
  }


  initialize(options) {
    this.model.set("isAdminView", options.isAdminView);
    return this.listenTo(this.model, "change", this.render);
  }


  finish() {
    if (confirm("Are you sure you want to permanently finish this tracing?")) {
      return this.model.finish();
    }
  }


  cancelAnnotation() {
    if (confirm("Do you really want to cancel this annotation?")) {
      const annotation = this.model.get("annotation");
      return Request.triggerRequest(`/annotations/${annotation.typ}/${annotation.id}`, { method: "DELETE" }).then(() => this.model.collection.fetch(),
      );
    }
  }
}
DashboardTaskListItemView.initClass();


export default DashboardTaskListItemView;
