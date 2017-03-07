import AbstractTabView from "oxalis/view/abstract_tab_view";
import TaskCreateFromView from "admin/views/task/task_create_subviews/task_create_from_view";
import TaskCreateBulkImportView from "admin/views/task/task_create_subviews/task_create_bulk_import_view";

class TaskCreateView extends AbstractTabView {
  static initClass() {
    this.prototype.id = "task-create";
  }

  getTabs() {
    return [
      {
        active: true,
        id: "tab-createFromForm",
        name: "Create Task",
        iconClass: "fa fa-tasks",
        viewClass: TaskCreateFromView,
        options: {
          type: "from_form",
          model: this.model,
        },
      },
      {
        id: "tab-createFromNML",
        name: "Create Task from NML File",
        iconClass: "fa fa-file",
        viewClass: TaskCreateFromView,
        options: {
          type: "from_nml",
          model: this.model,
        },
      },
      {
        id: "tab-createBulkImport",
        name: "Import Task in Bulk",
        iconClass: "fa fa-list",
        viewClass: TaskCreateBulkImportView,
        options: {
          model: this.model,
        },
      },
    ];
  }

  onRender() {
    return this.$el.addClass("container wide task-edit-administration");
  }
}
TaskCreateView.initClass();


export default TaskCreateView;
