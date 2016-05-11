_                      = require("lodash")
Marionette             = require("backbone.marionette")
ProjectListItemView    = require("./project_list_item_view")
CreateProjectModalView = require("./create_project_modal_view")

class ProjectsListView extends Marionette.CompositeView

  template : _.template("""
    <h3>Projects</h3>
    <table class="table table-double-striped table-details" id="projectlist-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Team</th>
          <th>Owner</th>
          <th>Open Assignments</th>
          <th>Actions</th>
        </tr>
      </thead>
    </table>
    <div id="modal-wrapper"></div>
  """)

  className : "container wide project-administration"
  childView : ProjectListItemView
  childViewContainer : "table"

  ui :
    "modalWrapper" : "#modal-wrapper"


  initialize : ->

    @collection.fetch()

    @listenTo(app.vent, "paginationView:filter", @filterBySearch)
    @listenTo(app.vent, "CreateProjectModal:refresh", @render)
    @listenTo(app.vent, "paginationView:addElement", @showModal)


  filterBySearch : (searchQuery) ->

    @collection.setFilter(["name", "team"], searchQuery)


  showModal : ->

    modalView = new CreateProjectModalView(projectCollection : @collection)
    @ui.modalWrapper.html(modalView.render().el)

    modalView.show()

module.exports = ProjectsListView
