### define
underscore : _
backbone.marionette : marionette
routes : routes
###

class TaskCreateView extends Backbone.Marionette.LayoutView

  id : "task-create"
  className : "container wide task-type-administration"
  template : _.template("""
      <div class="tabbable" id='tabbable-dashboard'>
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
      </div>
      <div class="tab-content">
        <div class="tab-pane active"></div>
      </div>

  """)
