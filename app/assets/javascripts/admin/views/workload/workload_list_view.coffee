### define
underscore : _
app : app
backbone.marionette : marionette
./workload_list_item_view : WorkloadListItemView
###

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

    @collection.fetch(
      silent : true
    ).done( =>
      @collection.setSort("availableTaskCount", "asc")
      @collection.goTo(1)
    )

    @listenTo(app.vent, "paginationView:filter", @filterByQuery)


  filterByQuery : (filterQuery) ->

    @collection.setFilter(["name", "projects"], filterQuery)
    @collection.pager()


