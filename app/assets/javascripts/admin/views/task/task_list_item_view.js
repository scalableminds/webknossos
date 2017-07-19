import _ from "lodash";
import app from "app";
import Marionette from "backbone.marionette";
import AnnotationCollection from "admin/models/task/annotation_collection";
import TemplateHelpers from "libs/template_helpers";
import TaskAnnotationView from "admin/views/task/task_annotation_view";
import TaskTransferModalView from "dashboard/views/task_transfer_modal_view";


class TaskListItemView extends Marionette.CompositeView {
  static initClass() {
    this.prototype.tagName = "tbody";

    this.prototype.template = _.template(`\
<tr>
  <td class="details-toggle" href="#">
    <i class="caret-right"></i>
    <i class="caret-down"></i>
  </td>
  <td>
    <div class="monospace-id">
      <%- id %>
    </div>
  </td>
  <td><%- team %></td>
  <td>
    <a href="/projects#<%- projectName %>">
      <%- projectName %>
    </a>
  </td>
  <td>
    <a href="/taskTypes#<%- type.id %>">
      <%- type.summary %>
    </a>
  </td>
  <td><%- dataSet %></td>
  <td class="nowrap">
    (<%- editPosition %>)<br>
    <span><%- TemplateHelpers.formatTuple(boundingBox) %></span>
  </td>
  <td>
    <% if (neededExperience.domain != "" || neededExperience.value > 0) { %>
      <span class="label label-default"><%- neededExperience.domain %> : <%- neededExperience.value %></span>
    <% } %>
  </td>
  <td><%- created %></td>
  <td class="nowrap">
    <span><i class="fa fa-play-circle"></i><%- status.open %></span><br>
    <span><i class="fa fa-random"></i><%- status.inProgress %></span><br>
    <span><i class="fa fa-check-circle-o"></i><%- status.completed %></span><br>
    <span><i class="fa fa-clock-o"></i><%- formattedTracingTime %></span>
  </td>
  <td class="nowrap">
    <a href="/tasks/<%- id %>/edit"><i class="fa fa-pencil"></i>edit</a><br>
    <% if (status.completed > 0) { %>
      <a href="/annotations/CompoundTask/<%- id %>" title="view all finished tracings"><i class="fa fa-random"></i>view</a><br>
      <a href="/api/tasks/<%- id %>/download" title="download all finished tracings"><i class="fa fa-download"></i>download</a><br>
    <% } %>
    <a href="#" class="delete"><i class="fa fa-trash-o"></i>delete</a>
  </td>
</tr>
<tr class="details-row hide" >
  <td colspan="13">
    <table class="table table-condensed table-nohead table-hover">
      <tbody>
      </tbody>
    </table>
    <div class="modal-container"></div>
  </td>
</tr>\
`);

    this.prototype.childView = TaskAnnotationView;
    this.prototype.childViewContainer = "tbody";

    this.prototype.events = {
      "click .delete": "deleteTask",
      "click .details-toggle": "toggleDetails",
      "click #transfer-task": "transferTask",
    };

    this.prototype.ui = {
      detailsRow: ".details-row",
      detailsToggle: ".details-toggle",
      modalContainer: ".modal-container",
    };

    this.prototype.templateContext =
      { TemplateHelpers };
  }
  attributes() {
    return { id: this.model.get("id") };
  }


  initialize() {
    this.listenTo(app.vent, "taskListView:toggleDetails", this.toggleDetails);
    this.collection = new AnnotationCollection(this.model.get("id"));

    // minimize the toggle view on item deletion
    this.listenTo(this.collection, "remove", () => this.toggleDetails());

    // refresh the list after transfering a task
    this.listenTo(app.vent, "modal:destroy", this.refresh);
  }

  deleteTask() {
    if (window.confirm("Do you really want to delete this task?")) {
      this.model.destroy();
    }
  }

  transferTask(evt) {
    evt.preventDefault();

    const modalContainer = new Marionette.Region({
      el: this.ui.modalContainer,
    });
    const url = evt.target.href;
    this.modal = new TaskTransferModalView({ url });
    modalContainer.show(this.modal);
  }

  toggleDetails() {
    if (this.ui.detailsRow.hasClass("hide")) {
      this.collection
        .fetch()
        .then(() => {
          this.render();
          this.ui.detailsRow.removeClass("hide");
          this.ui.detailsToggle.addClass("open");
        },
        );
    } else {
      this.ui.detailsRow.addClass("hide");
      this.ui.detailsToggle.removeClass("open");
    }
  }

  refresh() {
    this.collection.fetch().then(() => this.render());
  }
}
TaskListItemView.initClass();

export default TaskListItemView;
