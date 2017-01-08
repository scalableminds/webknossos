import _ from "lodash";
import app from "app";
import Marionette from "backbone.marionette";
import Toast from "libs/toast";
import Utils from "libs/utils";
import TaskListItemView from "./task_list_item_view";
import AnonymousTaskLinkModal from "./anonymous_task_link_modal";

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
        let id,
          name;
        if (name = this.collection.fullCollection.projectName) {
          return `Tasks for Project ${name}`;
        } else if (id = this.collection.fullCollection.taskTypeId) {
          return `Tasks for TaskType ${id}`;
        }
      },
    };
  }


  initialize() {
    this.listenTo(app.vent, "paginationView:filter", this.filterBySearch);
    this.listenTo(app.vent, "paginationView:addElement", this.createNewTask);
    this.listenTo(this.collection, "sync", this.showAnonymousLinks);

    return this.collection.fetch();
  }


  createNewTask() {
    let id,
      name,
      urlParam;
    if (name = this.collection.fullCollection.projectName) {
      urlParam = `?projectName=${name}`;
    } else if (id = this.collection.fullCollection.taskTypeId) {
      urlParam = `?taskType=${id}`;
    } else {
      urlParam = "";
    }

    // The trailing '#' is important for routing
    return app.router.navigate(`/tasks/create${urlParam}#`, { trigger: true });
  }


  toggleAllDetails() {
    this.ui.detailsToggle.toggleClass("open");
    return app.vent.trigger("taskListView:toggleDetails");
  }


  showAnonymousLinks() {
    const anonymousTaskId = Utils.getUrlParams("showAnonymousLinks");
    if (!anonymousTaskId) { return; }

    const task = this.collection.findWhere({ id: anonymousTaskId });
    if (task && task.get("directLinks")) {
      return this.showModal(task);
    } else {
      return Toast.error(`Unable to find anonymous links for task ${anonymousTaskId}.`);
    }
  }


  showModal(task) {
    const modalView = new AnonymousTaskLinkModal({ model: task });
    modalView.render();
    this.ui.modalWrapper.html(modalView.el);

    modalView.show();
    return this.modalView = modalView;
  }


  onDestroy() {
    return __guard__(this.modalView, x => x.destroy());
  }


  filterBySearch(searchQuery) {
    return this.collection.setFilter(["team", "projectName", "id", "dataSet", "created"], searchQuery);
  }
}
TaskListView.initClass();

export default TaskListView;

function __guard__(value, transform) {
  return (typeof value !== "undefined" && value !== null) ? transform(value) : undefined;
}
