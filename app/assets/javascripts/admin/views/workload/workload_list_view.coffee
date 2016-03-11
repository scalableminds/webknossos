_                    = require("lodash")
app                  = require("app")
Marionette           = require("backbone.marionette")
WorkloadListItemView = require("./workload_list_item_view")
SortTableBehavior    = require("libs/behaviors/sort_table_behavior")


class WorkloadListView extends Marionette.CompositeView

  template : _.template("""
    <h3>Workload</h3>
      <table class="table table-striped sortable-table">
        <thead>
          <tr>
            <th data-sort="name">Name</th>
            <th>Teams</th>
            <th data-sort="projects">Projects</th>
            <th data-sort="availableTaskCount">Number of all assignable tasks</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
  """)
  className : "workload-table container wide"
  childView : WorkloadListItemView
  childViewContainer : "tbody"

  behaviors:
    SortTableBehavior:
      behaviorClass: SortTableBehavior

  initialize : ->

    @collection.fetch().done( =>
      @collection.setSorting("availableTaskCount", 1)
    )

    @listenTo(app.vent, "paginationView:filter", @filterByQuery)


  filterByQuery : (filterQuery) ->

    @collection.setFilter(["name", "teams", "projects"], filterQuery)


module.exports = WorkloadListView
