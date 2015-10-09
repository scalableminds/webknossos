_                         = require("lodash")
marionette                = require("backbone.marionette")
DashboardTaskListItemView = require("dashboard/views/dashboard_task_list_item_view")
routes                    = require("routes")

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
          <td> <%= entry.time %> </td>
        </tr>
      <% }) %>
      </tbody>
    </table>
    """)


  initialize : (options) ->

    @listenTo(@model, "sync", @render)

    @model.fetch()


module.exports = TrackedTimeView
