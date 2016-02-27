TaskCreateFromView        = require("./task_create_subviews/task_create_from_view")
TaskCreateBulkImportView  = require("./task_create_subviews/task_create_bulk_import_view")
AbstractTabView           = require("oxalis/view/abstract_tab_view")

class TaskCreateView extends AbstractTabView

  id : "task-create"

  getTabs : ->
    [
      {
        active : true
        id : "tab-createFromForm"
        name : "Create Task"
        iconClass : "fa fa-tasks"
        viewClass : TaskCreateFromView
        options :
          type : "from_form"
          model : @model
      }
      {
        id : "tab-createFromNML"
        name : "Create Task from NML File"
        iconClass : "fa fa-file"
        viewClass : TaskCreateFromView
        options :
          type : "from_nml"
          model : @model
      }
      {
        id : "tab-createBulkImport"
        name : "Import Task in Bulk"
        iconClass : "fa fa-list"
        viewClass : TaskCreateBulkImportView
        options :
          model : @model
      }
    ]

  onRender : ->

    @$el.addClass("container wide task-edit-administration")



module.exports = TaskCreateView
