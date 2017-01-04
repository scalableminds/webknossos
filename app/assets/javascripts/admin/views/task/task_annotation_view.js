import _ from "lodash";
import $ from "jquery";
import moment from "moment";
import Toast from "libs/toast";
import Request from "libs/request";
import Marionette from "backbone.marionette";
import AnnotationModel from "admin/models/task/annotation_model";

class TaskAnnotationView extends Marionette.View {
  static initClass() {

    this.prototype.tagName  = "tr";

    this.prototype.template  = _.template(`\
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
    <% _.each(actions, function(action){ %>
    <li>
      <a href="<%- action.call.url %>" class="<% if(action.isAjax){ %>isAjax<% } %>"><i class="<%- action.icon %>"></i><%- action.name %></a>
    </li>
    <% }) %>
    <li>
      <a href="#" class="cancel-annotation"><i class="fa fa-trash-o"></i>cancel</a>
    </li>
    </ul>
  </div>
</td>\
`);

    this.prototype.templateContext  =
      {moment};

    this.prototype.events  = {
      "click .isAjax" : "callAjax",
      "click .cancel-annotation" : "cancelAnnotation"
    };

    this.prototype.modelEvents  =
      {"change" : "render"};
  }
  attributes() {
    return {id : this.model.get("id")};
  }


  // some actions are real links and some need to be send as ajax calls to the server
  callAjax(evt) {

    evt.preventDefault();

    return Request.receiveJSON($(evt.target).prop("href")).then( jsonData => {
      this.model.set(jsonData);
      const message = jsonData.messages;
      return Toast.message(message);
    }
    );
  }


  cancelAnnotation() {

    if (window.confirm("Do you really want to cancel this annotation?")) {
      return this.model.destroy();
    }
  }
}
TaskAnnotationView.initClass();

export default TaskAnnotationView;
