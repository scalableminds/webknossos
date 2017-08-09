/**
 * dashboard_task_list_view.js
 * @flow weak
 */

import _ from "lodash";
import app from "app";
import Utils from "libs/utils";
import Marionette from "backbone.marionette";
import SortTableBehavior from "libs/behaviors/sort_table_behavior";
import DashboardTaskListItemView from "dashboard/views/dashboard_task_list_item_view";
import TaskTransferModalView from "dashboard/views/task_transfer_modal_view";
import UserTasksCollection from "dashboard/models/user_tasks_collection";

class DashboardTaskListView extends Marionette.CompositeView {
  showFinishedTasks: boolean;
  modal: TaskTransferModalView;

  static initClass() {
    this.prototype.template = _.template(`\
<h3>Tasks</h3>
<% if (isAdminView) { %>
  <a href="/api/users/<%- id %>/annotations/download"
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
  Show <%- getFinishVerb() %> tasks only
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

    this.prototype.ui = { modalContainer: ".modal-container" };

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

  // Cannot be ES6 style function, as these are covariant by default
  childViewOptions = function childViewOptions() {
    return { isAdminView: this.options.isAdminView };
  };

  // Cannot be ES6 style function, as these are covariant by default
  templateContext = function templateContext() {
    return {
      isAdminView: this.options.isAdminView,
      getFinishVerb: () => (this.showFinishedTasks ? "unfinished" : "finished"),
    };
  };

  initialize(options) {
    this.options = options;
    this.showFinishedTasks = false;

    // If you know how to do this better, do it. Backbones Collection type is not compatible to Marionettes
    // Collection type according to flow - although they actually should be...
    this.collection = ((new UserTasksCollection([], {
      userID: this.options.userID,
    }): any): Marionette.Collection);

    // Show a loading spinner for long running requests
    this.listenTo(this.collection, "request", () => app.router.showLoadingSpinner());
    this.listenTo(this.collection, "error", () => app.router.hideLoadingSpinner());
    // Hide the spinner if the collection is empty or after rendering all elements of the (long) table
    this.listenTo(this.collection, "sync", () => {
      if (this.collection.length === 0) app.router.hideLoadingSpinner();
    });
    this.listenTo(this, "add:child", () => app.router.hideLoadingSpinner());

    this.collection.fetch();

    this.listenTo(app.vent, "modal:destroy", this.refresh);
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

    if (
      this.collection.filter(UserTasksCollection.prototype.unfinishedTasksFilter).length === 0 ||
      confirm("Do you really want another task?")
    ) {
      // Need to make sure this.collection is a UserTasksCollection with the getNewTask
      // method, otherwise flow complains
      app.router.showLoadingSpinner();
      if (this.collection instanceof UserTasksCollection) {
        this.collection
          .getNewTask()
          .then(() => app.router.hideLoadingSpinner(), () => app.router.hideLoadingSpinner());
      }
    }
  }

  toggleFinished() {
    this.showFinishedTasks = !this.showFinishedTasks;
    // Need to make sure this.collection is a UserTasksCollection with the isFinished
    // attribute, otherwise flow complains
    if (this.collection instanceof UserTasksCollection) {
      this.collection.isFinished = this.showFinishedTasks;
    }
    this.refresh();
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

  refresh() {
    this.collection.fetch().then(() => this.render());
  }

  onDestroy() {
    Utils.__guard__(this.modal, x => x.destroy());
  }
}
DashboardTaskListView.initClass();

export default DashboardTaskListView;
