### define
underscore : _
backbone.marionette : marionette
routes : routes
###

class TaskCreateView extends Backbone.Marionette.LayoutView

  id : "task-create"
  className : "container task-type-administration"
  template : _.template("""
      <ul class="nav nav-tabs">
        <li class="active">
          <a href="#" id="tab-create" data-toggle="tab">Create Task</a>
        </li>
        <li>
          <a href="#" id="tab-createFromNML" data-toggle="tab">Create Task from IML File</a>
        </li>
        <li>
          <a href="#" id="tab-createBulkImport" data-toggle="tab">Import Task in Bulk</a>
        </li>
      </ul>
      <div class="tab-content">
        <div class="tab-pane active"></div>
      </div>

  """)
