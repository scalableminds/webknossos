import _ from "lodash";
import $ from "jquery";
import moment from "moment";
import Toast from "libs/toast";
import Request from "libs/request";
import Utils from "libs/utils";
import Marionette from "backbone.marionette";

class TaskAnnotationView extends Marionette.View {
  static initClass() {
    this.prototype.tagName = "tr";

    this.prototype.template = _.template(`\
<td><%- user.firstName %> <%- user.lastName %> (<%- user.email %>)</td>
<td><%- moment(created).format("YYYY-MM-DD HH:SS") %></td>
<td><span><i class="fa fa-check-circle-o"></i><%- stateLabel %></span><br /><span><i class="fa fa-clock-o"></i><%- formattedTracingTime %></span></td>
<td class="nowrap">
  <div class="btn-group">
    <a class="btn dropdown-toggle" data-toggle="dropdown" href="#">
      Actions
      <span class="caret"></span>
    </a>
    <ul class="dropdown-menu">
      <li><a href="/annotations/Task/<%- id %>">
        <i class="fa fa-random"></i>
        <%- state.isFinished ? "view" : "trace" %>
      </a></li>
      <li><a href="/annotations/Task/<%- id %>/transfer" id="transfer-task">
        <i class="fa fa-share"></i>
        transfer
      </a></li>
      <li><a href="/annotations/Task/<%- id %>/download">
        <i class="fa fa-download"></i>
        download
      </a></li>
      <li><a href="/annotations/Task/<%- id %>/reset" class="isAjax">
        <i class="fa fa-undo"></i>
        reset
      </a></li>
      <li><a href="#" id="cancel-annotation">
        <i class="fa fa-trash-o"></i>
        cancel
      </a></li>
      <% if (state.isFinished) { %>
        <li><a href="/annotations/Task/<%- id %>/reopen" class="isAjax">
          <i class="fa fa-share"></i>
          reopen
        </a></li>
      <% } else { %>
        <li><a href="/annotations/Task/<%- id %>/finish" class="isAjax">
          <i class="fa fa-check-circle-o"></i>
          finish
        </a></li>
      <% } %>
    </ul>
  </div>
</td>\
`);

    this.prototype.templateContext =
      { moment };

    this.prototype.events = {
      "click .isAjax": "callAjax",
      "click #cancel-annotation": "cancelAnnotation",
    };

    this.prototype.modelEvents =
      { change: "render" };
  }
  attributes() {
    return { id: this.model.get("id") };
  }

  // some actions are real links and some need to be send as ajax calls to the server
  callAjax(evt) {
    evt.preventDefault();

    Request.receiveJSON($(evt.target).prop("href")).then((jsonData) => {
      this.model.set(jsonData);
      const message = jsonData.messages;
      Toast.message(message);
    },
    );
  }

  cancelAnnotation() {
    if (window.confirm("Do you really want to cancel this annotation?")) {
      this.model.destroy();
    }
  }

  onDestroy() {
    Utils.__guard__(this.modal, x => x.destroy());
  }
}
TaskAnnotationView.initClass();

export default TaskAnnotationView;
