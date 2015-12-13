_                    = require("lodash")
app                  = require("app")
marionette           = require("backbone.marionette")
WorkloadListItemView = require("./workload_list_item_view")

class WorkloadListView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <h3>Workload</h3>
      <table class="table table-striped">
        <thead>
          <tr>
            <th>Name</th>
            <th>Projects</th>
            <th>Number of all assignable tasks</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
  """)
  className : "workload-table container wide"
  childView : WorkloadListItemView
  childViewContainer : "tbody"

  initialize : ->

    @collection.fetch().done( =>
      @collection.setSorting("availableTaskCount", 1)
    )

    @listenTo(app.vent, "paginationView:filter", @filterByQuery)


  filterByQuery : (filterQuery) ->

    @collection.setFilter(["name", "projects"], filterQuery)
    @collection.pager()


module.exports = WorkloadListView
