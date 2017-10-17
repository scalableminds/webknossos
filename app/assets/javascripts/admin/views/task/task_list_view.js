import _ from "lodash";
import app from "app";
import Utils from "libs/utils";
import Marionette from "backbone.marionette";
import Toast from "libs/toast";
import TaskListItemView from "admin/views/task/task_list_item_view";
import AnonymousTaskLinkModal from "admin/views/task/anonymous_task_link_modal";

class TaskListView extends Marionette.CompositeView {
  static initClass() {
    this.prototype.template = _.template(`\
<h3><%- getTitle() %></h3>
<table id="tasklist-table" class="table table-double-striped table-details">
  <thead>
    <tr>
      <th class="details-toggle-all"><i class="caret-right"></i><i class="caret-down"></i></th>
      <th>#</th>
      <th>Team</th>
      <th>Project</th>
      <th>Type</th>
      <th>DataSet</th>
      <th>Edit position /<br> Bounding Box</th>
      <th>Experience</th>
      <th>Created</th>
      <th>Stats</th>
      <th>Actions</th>
     </tr>
  </thead>
</table>
<div id="modal-wrapper"></div>\
`);

    this.prototype.className = "task-administration container wide";
    this.prototype.childView = TaskListItemView;
    this.prototype.childViewContainer = "table";

    this.prototype.ui = {
      modal: ".modal",
      inputName: "#inputName",
      detailsToggle: ".details-toggle-all",
      modalWrapper: "#modal-wrapper",
    };

    this.prototype.events = {
      "click #new-team": "showModal",
      "click .modal .btn-primary": "addNewTeam",
      "click @ui.detailsToggle": "toggleAllDetails",
    };
  }

  templateContext() {
    return {
      getTitle: () => {
        const id = this.collection.fullCollection.taskTypeId;
        const name = this.collection.fullCollection.projectName;
        if (name) {
          return `Tasks for Project ${name}`;
        } else if (id) {
          return `Tasks for TaskType ${id}`;
        }
        return "";
      },
    };
  }

  initialize() {
    this.listenTo(app.vent, "paginationView:filter", this.filterBySearch);
    this.listenTo(app.vent, "paginationView:addElement", this.createNewTask);
    this.listenTo(this.collection, "sync", this.showAnonymousLinks);

    this.collection.fetch();
  }

  createNewTask() {
    let urlParam;
    const id = this.collection.fullCollection.taskTypeId;
    const name = this.collection.fullCollection.projectName;
    if (name) {
      urlParam = `?projectName=${name}`;
    } else if (id) {
      urlParam = `?taskType=${id}`;
    } else {
      urlParam = "";
    }

    this.props.history.push(`/tasks/create${urlParam}`);
  }

  toggleAllDetails() {
    this.ui.detailsToggle.toggleClass("open");
    app.vent.trigger("taskListView:toggleDetails");
  }

  showAnonymousLinks() {
    const anonymousTaskId = Utils.getUrlParams("showAnonymousLinks");
    if (!anonymousTaskId) {
      return;
    }

    const task = this.collection.findWhere({ id: anonymousTaskId });
    if (task && task.get("directLinks")) {
      this.showModal(task);
    } else {
      Toast.error(`Unable to find anonymous links for task ${anonymousTaskId}.`);
    }
  }

  showModal(task) {
    const modalView = new AnonymousTaskLinkModal({ model: task });
    modalView.render();
    this.ui.modalWrapper.html(modalView.el);

    modalView.show();
    this.modalView = modalView;
  }

  onDestroy() {
    Utils.__guard__(this.modalView, x => x.destroy());
  }

  filterBySearch(searchQuery) {
    return this.collection.setFilter(
      ["team", "projectName", "id", "dataSet", "created"],
      searchQuery,
    );
  }
}
TaskListView.initClass();

export default TaskListView;
