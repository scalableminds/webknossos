### define
underscore : _
app : app
backbone.marionette : marionette
libs/behaviors/sort_table_behavior : SortTableBehavior
./workload_list_item_view : WorkloadListItemView
###

class WorkloadListView extends Backbone.Marionette.CompositeView

  # TODO: WORKLOAD CURRENTLY DISABLED DUE TO PERFORMANCE REASONS
#  template : _.template("""
#    <h3>Workload</h3>
#      <table class="table table-striped sortable-table">
#        <thead>
#          <tr>
#            <th data-sort="name">Name</th>
#            <th>Teams</th>
#            <th data-sort="projects">Projects</th>
#            <th data-sort="availableTaskCount">Number of all assignable tasks</th>
#          </tr>
#        </thead>
#        <tbody></tbody>
#      </table>
#  """)

  template: _.template("""
    <h3>Workload</h3>
    <p>Disabled due to performance issues.</p>
  """)
  className : "workload-table container wide"
  childView : WorkloadListItemView
  childViewContainer : "tbody"

  behaviors:
    SortTableBehavior:
      behaviorClass: SortTableBehavior

  initialize : ->

    @collection.fetch(
      silent : true
    ).done( =>
      @collection.setSort("availableTaskCount", "asc")
      @collection.goTo(1)
    )

    @listenTo(app.vent, "paginationView:filter", @filterByQuery)


  filterByQuery : (filterQuery) ->

    @collection.setFilter(["name", "teams", "projects"], filterQuery)
    @collection.pager()


