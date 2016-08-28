_                      = require("lodash")
Marionette             = require("backbone.marionette")
ProjectListItemView    = require("./project_list_item_view")
SortTableBehavior      = require("libs/behaviors/sort_table_behavior")

class ProjectsListView extends Marionette.CompositeView

  template : _.template("""
    <h3>Projects</h3>
    <table class="table table-striped table-details sortable-table" id="projectlist-table">
      <thead>
        <tr>
          <th data-sort="name">Name</th>
          <th data-sort="team">Team</th>
          <th data-sort="priority">Priority</th>
          <th data-sort="location">Location</th>
          <th data-sort="owner.lastName">Owner</th>
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

  behaviors :
    SortTableBehavior:
      behaviorClass: SortTableBehavior


  initialize : ->

    @collection.fetch()
    @collection.setSorting("priority", "desc")

    @listenTo(app.vent, "paginationView:filter", @filterBySearch)
    @listenTo(app.vent, "modal:destroy", @render)
    @listenTo(app.vent, "paginationView:addElement", @createProject)


  filterBySearch : (searchQuery) ->

    @collection.setFilter(["name", "team", "priority", "location"], searchQuery)


  createProject : ->

    app.router.navigate("/projects/create", {trigger : true})

module.exports = ProjectsListView
