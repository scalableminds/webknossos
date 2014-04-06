### define
underscore : _
backbone.marionette : marionette
dashboard/views/dashboard_task_list_item_view : DashboardTaskListItemView
dashboard/models/logged_time_model : LoggedTimeModel
routes : routes
###

class TrackedTimeView extends Backbone.Marionette.CompositeView

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
      <% _.each(formattedLogs, function(entry) { %>
        <tr>
          <td> <%= entry.interval %> </td>
          <td> <%= entry.time     %> </td>
        </tr>
      <% }) %>
      </tbody>
    </table>
    """)


  initialize : (options) ->

    @model.set("formattedLogs", [])

    loggedTime = new LoggedTimeModel()
    @listenTo(loggedTime, "sync", =>
      @model.set("formattedLogs", loggedTime.getFormattedLogs())
      @render()
    )
    loggedTime.fetch()
