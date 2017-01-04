import _ from "lodash";
import app from "app";
import Marionette from "backbone.marionette";
import DashboardTaskListItemView from "./dashboard_task_list_item_view";
import TaskTransferModalView from "./task_transfer_modal_view";
import routes from "routes"; // eslint-disable-line no-unused-vars
import SortTableBehavior from "libs/behaviors/sort_table_behavior";
import UserTasksCollection from "../models/user_tasks_collection";

class DashboardTaskListView extends Marionette.CompositeView {
  static initClass() {
    this.prototype.template = _.template(`\
<h3>Tasks</h3>
<% if (isAdminView) { %>
  <a href="<%- jsRoutes.controllers.AnnotationIOController.userDownload(id).url %>"
     class="btn btn-primary"
     title="download all finished tracings">
      <i class="fa fa-download"></i>download
  </a>
<% } else { %>
  <a href="#"
     class="btn btn-success"
     id="new-task-button">
     Get a new task
  </a>
<% } %>
<div class="divider-vertical"></div>
<a href="#" id="toggle-finished" class="btn btn-default">
  Show <%= getFinishVerb() %> tasks only
</a>
<table class="table table-striped sortable-table">
  <thead>
    <tr>
      <th data-sort="formattedHash"># </th>
      <th data-sort="type.summary">Type </th>
      <th data-sort="projectName">Project </th>
      <th data-sort="type.description">Description </th>
      <th>Modes </th>
      <th data-sort="created">Created</th>
      <th></th>
    </tr>
  </thead>
  <tbody></tbody>
</table>
<div class="modal-container"></div>\
`);

    this.prototype.childViewContainer = "tbody";
    this.prototype.childView = DashboardTaskListItemView;


    this.prototype.ui =
      { modalContainer: ".modal-container" };

    this.prototype.events = {
      "click #new-task-button": "newTask",
      "click #transfer-task": "transferTask",
      "click #toggle-finished": "toggleFinished",
    };

    this.prototype.behaviors = {
      SortTableBehavior: {
        behaviorClass: SortTableBehavior,
      },
    };
  }
  childViewOptions() {
    return { isAdminView: this.options.isAdminView };
  }


  templateContext() {
    return {
      isAdminView: this.options.isAdminView,
      getFinishVerb: () => this.showFinishedTasks ? "unfinished" : "finished",
    };
  }


  initialize(options) {
    this.options = options;
    this.showFinishedTasks = false;
    this.collection = new UserTasksCollection([], { userID: this.options.userID });
    this.collection.fetch();

    return this.listenTo(app.vent, "modal:destroy", this.refresh);
  }

  filter(child) {
    if (this.showFinishedTasks) {
      return child.get("annotation.state.isFinished");
    } else {
      return !child.get("annotation.state.isFinished");
    }
  }

  newTask(event) {
    event.preventDefault();

    if (this.collection.filter(UserTasksCollection.prototype.unfinishedTasksFilter).length === 0 || confirm("Do you really want another task?")) {
      return this.collection.getNewTask();
    }
  }


  toggleFinished() {
    this.showFinishedTasks = !this.showFinishedTasks;
    this.collection.isFinished = this.showFinishedTasks;
    return this.refresh();
  }


  transferTask(evt) {
    evt.preventDefault();

    const modalContainer = new Marionette.Region({
      el: this.ui.modalContainer,
    });
    const url = evt.target.href;
    this.modal = new TaskTransferModalView({ url });
    return modalContainer.show(this.modal);
  }


  refresh() {
    return this.collection.fetch().then(() => this.render(),
    );
  }

  onDestroy() {
    return __guard__(this.modal, x => x.destroy());
  }
}
DashboardTaskListView.initClass();


export default DashboardTaskListView;

function __guard__(value, transform) {
  return (typeof value !== "undefined" && value !== null) ? transform(value) : undefined;
}
