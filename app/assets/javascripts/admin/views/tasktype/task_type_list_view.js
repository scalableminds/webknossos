import _ from "lodash";
import app from "app";
import Marionette from "backbone.marionette";
import TaskTypeListItemView from "admin/views/tasktype/task_type_list_item_view";

class TaskTypeListView extends Marionette.CompositeView {
  constructor(...args) {
    super(...args);
    this.template = this.template.bind(this);
  }

  static initClass() {
    this.prototype.className = "container wide task-types-administration";
    this.prototype.childView = TaskTypeListItemView;
    this.prototype.childViewContainer = "tbody";
  }

  template() {
    return _.template(`\
<h3>Task Types</h3>
<table class="table table-striped table-details" id="tasktype-table">
  <thead>
    <tr>
      <th> # </th>
      <th> Team </th>
      <th> Summary </th>
      <th> Description </th>
      <th> Add-On Modes </th>
      <th> Settings </th>
      <th> Attached File </th>
      <th></th>
    </tr>
  </thead>
  <tbody></tbody>
</table>\
`);
  }


  initialize() {
    this.collection.fetch();

    this.listenTo(app.vent, "paginationView:filter", this.filterBySearch);
    this.listenTo(app.vent, "paginationView:addElement", this.createNewTaskType);
  }


  createNewTaskType() {
    return app.router.navigate("/taskTypes/create", { trigger: true });
  }


  filterBySearch(searchQuery) {
    return this.collection.setFilter(["summary", "team", "description", "id"], searchQuery);
  }
}
TaskTypeListView.initClass();


export default TaskTypeListView;
