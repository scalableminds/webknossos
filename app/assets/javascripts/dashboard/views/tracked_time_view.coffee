### define
underscore : _
backbone.marionette : marionette
app : app
dashboard/views/dashboard_task_list_item_view : DashboardTaskListItemView
routes : routes
###

class TrackedTimeView extends Backbone.Marionette.View

  template : _.template("""
    <h3>Tracked Time</h3>
    <table class="table table-striped">
      <thead>
        <tr>
          <th> Month </th>
          <th> Worked </th>
        </tr>
      </thead>
      <tbody>
      @dashboardInfo.loggedTime.toList.sortBy({ case (interval, time) => interval }).map{ case (interval, time) =>
        <tr>
          <td> @interval </td>
          <td> @formatTimeHumanReadable(time) </td>
        </tr>
      }
      </tbody>
    </table>
    """)


  initialize : (options) ->

    console.log "options", options
    @model = options.model

    @collection = @model.get("tasks")

