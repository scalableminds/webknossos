/**
 * dashboard_task_list_item_view.js
 * @flow weak
 */

import _ from "lodash";
import Marionette from "backbone.marionette";
import Request from "libs/request";
import moment from "moment";
import Toast from "libs/toast";

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
    <ul>
      <li><a href="/annotations/Task/<%- annotation.id %>">
        <i class="fa fa-random"></i>
        <strong>trace</strong>
      </a></li>
      <% if (isAdminView) { %>
        <li><a href="/annotations/Task/<%- annotation.id %>/transfer" id="transfer-task">
          <i class="fa fa-share"></i>
          transfer
        </a></li>
        <li><a href="/annotations/Task/<%- annotation.id %>/download">
          <i class="fa fa-download"></i>
          download
        </a></li>
        <li><a href="/annotations/Task/<%- annotation.id %>/reset" class="isAjax">
          <i class="fa fa-undo"></i>
          reset
        </a></li>
        <li><a href="#" id="cancel-task">
          <i class="fa fa-trash-o"></i>
          cancel
        </a></li>
      <% } %>
      <li><a href="#" id="finish-task">
        <i class="fa fa-check-circle-o"></i>
        finish
      </a></li>
    </ul>
  <% } %>
</td>\
`);

    this.prototype.templateContext = { moment };

    this.prototype.events = {
      "click #finish-task": "finish",
      "click #cancel-task": "cancelAnnotation",
      "click .isAjax": "callAjax",
    };
  }

  // Cannot be ES6 style function, as these are covariant by default
  className = function className() {
    if (this.model.get("annotation.state.isFinished")) {
      return "finished";
    }
    return "unfinished";
  };

  initialize(options) {
    this.model.set("isAdminView", options.isAdminView);
    this.listenTo(this.model, "change", this.render);
  }

  // some actions are real links and some need to be send as ajax calls to the server
  callAjax(evt) {
    evt.preventDefault();

    Request.receiveJSON(evt.target.href).then(jsonData => {
      Toast.message(jsonData.messages);
    });
  }

  finish() {
    if (confirm("Are you sure you want to permanently finish this tracing?")) {
      this.model.finish();
    }
  }

  cancelAnnotation() {
    if (confirm("Do you really want to cancel this annotation?")) {
      const annotation = this.model.get("annotation");
      Request.triggerRequest(`/annotations/Task/${annotation.id}`, { method: "DELETE" }).then(() =>
        this.model.collection.fetch(),
      );
    }
  }
}
DashboardTaskListItemView.initClass();

export default DashboardTaskListItemView;
