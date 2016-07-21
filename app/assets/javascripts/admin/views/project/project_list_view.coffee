_                      = require("lodash")
Marionette             = require("backbone.marionette")
ProjectListItemView    = require("./project_list_item_view")
CreateProjectModalView = require("./create_project_modal_view")
SortTableBehavior       = require("libs/behaviors/sort_table_behavior")

class ProjectsListView extends Marionette.CompositeView

  template : _.template("""
    <h3>Projects</h3>
    <table class="table table-striped table-details sortable-table" id="projectlist-table">
      <thead>
        <tr>
          <th data-sort="name">Name</th>
          <th data-sort="team">Team</th>
          <th data-sort="owner">Owner</th>
          <th data-sort="numberOfOpenAssignments">Open Assignments</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
    <div id="modal-wrapper"></div>
  """)

  className : "container wide project-administration"
  childView : ProjectListItemView
  childViewContainer : "tbody"

  behaviors :
    SortTableBehavior:
      behaviorClass: SortTableBehavior

  ui :
    "modalWrapper" : "#modal-wrapper"


  initialize : ->

    @collection.fetch()
    @collection.setSorting("numberOfOpenAssignments", "desc")

    @listenTo(app.vent, "paginationView:filter", @filterBySearch)
    @listenTo(app.vent, "modal:destroy", @render)
    @listenTo(app.vent, "paginationView:addElement", @showModal)


  filterBySearch : (searchQuery) ->

    @collection.setFilter(["name", "team"], searchQuery)


  showModal : ->

    modalView = new CreateProjectModalView(projectCollection : @collection)
    @ui.modalWrapper.html(modalView.render().el)

    modalView.show()

module.exports = ProjectsListView
