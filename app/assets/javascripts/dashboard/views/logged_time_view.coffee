### define
underscore : _
backbone.marionette : marionette
c3 : c3
dashboard/views/dashboard_task_list_item_view : DashboardTaskListItemView
../models/logged_time_collection : LoggedTimeCollection
###

class LoggedTimeView extends Backbone.Marionette.ItemView

  template : _.template("""
    <h3>Tracked Time</h3>
    <div id="graph"></div>
  """)

  initialize : (options) ->


    @collection = new LoggedTimeCollection([], options)
    @listenTo(@collection, "sync", @addGraph)
    @collection.fetch()


  addGraph : ->

    dates = @collection.map((item) -> return item.get("interval").toDate())
    monthlyMinutes = @collection.map((item) -> return parseInt item.get("time"))

    graph = c3.generate(
      bindto : "#graph"
      data:
        x: "date"
        columns: [
          ["date"].concat(dates)
          ["monthlyMinutes"].concat(monthlyMinutes)
        ]
      axis :
        x :
          type : "timeseries"
          tick :
            format : "%Y %m"
        y :
          label : "minutes / month"
      legend :
        show : false
    )

