### define
underscore : _
backbone.marionette : marionette
routes : routes
admin/views/task/task_create_from_form_view : TaskCreateFromFormView
admin/views/task/task_create_from_nml_view : TaskCreateFromNMLView
admin/views/task/task_create_bulk_import_view : TaskCreateBulkImportView
###

class TaskCreateView extends Backbone.Marionette.LayoutView

  # keep track of the active view
  activeView : null

  id : "task-create"
  className : "container wide task-type-administration"
  template : _.template("""
      <div class="tabbable" id="tabbable-dashboard">

        <ul class="nav nav-tabs">
          <li class="active">
            <a href="#" id="tab-createFromForm" data-toggle="tab">Create Task</a>
          </li>
          <li>
            <a href="#" id="tab-createFromNML" data-toggle="tab">Create Task from NML File</a>
          </li>
          <li>
            <a href="#" id="tab-createBulkImport" data-toggle="tab">Import Task in Bulk</a>
          </li>
        </ul>

        <div class="tab-content">
          <div class="tab-pane active"></div>
        </div>

      </div> <!-- END .tabbable -->
  """)

  regions:
      # content region for tabs
      tabPane: ".tab-pane"

  events:
      # trigger tab changes
      "click #tab-createFromForm" : "showTabCreateFromForm"
      "click #tab-createFromNML" : "showTabCreateFromNML"
      "click #tab-createBulkImport" : "showTabCreateBulkImport"

  # change to activated tabs

  ###*
   * Activate Default Form View
   *
   * @method showTabCreateFromForm
   ###
  showTabCreateFromForm: ->

      @activeView = new TaskCreateFromFormView()
      @tabPane.show(@activeView)


  ###*
   * Activate NML Form View
   *
   * @method showTabCreateFromNML
   ###
  showTabCreateFromNML: ->

      @activeView = new TaskCreateFromNMLView()
      @tabPane.show(@activeView)


  ###*
   * Activate Bulk Import View
   *
   * @method showTabCreateBulkImport
   ###
  showTabCreateBulkImport: ->

      @activeView = new TaskCreateBulkImportView()
      @tabPane.show(@activeView)

  ###*
  * Show default on startup
  *
  * @method onRender
  ###
  onRender: ->

      @showTabCreateFromForm()

