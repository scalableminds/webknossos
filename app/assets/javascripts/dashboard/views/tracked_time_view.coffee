### define
underscore : _
backbone.marionette : marionette
dashboard/views/dashboard_task_list_item_view : DashboardTaskListItemView
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

    @model = options.model

    formattedLogs = @model.get("loggedTime")
      .map( (entry) ->

        t = moment.duration(seconds: entry.durationInSeconds)
        [ days, hours, minutes ] = [ t.days(), t.hours(), t.minutes() ]
        interval = entry.paymentInterval

        return {
          time :
            if days == 0 and hours == 0
              "#{minutes}m"
            else if days == 0
              "#{hours}h #{minutes}m"
            else
              "#{days}d #{hours}h #{minutes}m"

          interval : interval.year + "-" + interval.month
        }
      )
      .sort( (a, b) -> a.interval > b.interval )

    @model.set("formattedLogs", formattedLogs)
