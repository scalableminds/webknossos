_          = require("lodash")
app        = require("app")
Marionette = require("backbone.marionette")
c3         = require("c3")
moment     = require("moment")

class GraphView extends Marionette.View

  template : _.template("""
    <h3>Overall Weekly Tracing Time</h3>
    <div id="graph"></div>
  """)


  initialize : ->

    @listenTo(@, "attach", @addGraph)


  addGraph : ->


    previousWeeks = @model.get("tracingTimes").map((item) -> return parseInt moment.duration(item.get("tracingTime")).asHours())
    currentWeek = previousWeeks.length - 1

    dates = @model.get("tracingTimes").map((item) -> return moment(item.get("start")).format("YYYY-MM-DD"))

    graph = c3.generate(
      bindto : "#graph"
      data :
        x : "date"
        columns: [
          ["date"].concat(dates)
          ["WeeklyHours"].concat(previousWeeks)
        ]
        color : (color, d) -> return if d.index == currentWeek then "#48C561" else color # color current week differently
        selection :
          enabled : true
          grouped : false
          multiple : false
        onclick : @selectDataPoint
      axis :
        x :
          type : "timeseries"
        y :
          label : "hours / week"
      legend :
        show : false
    )


  selectDataPoint : (data) ->

    app.vent.trigger("graphView:updatedSelection", data)

module.exports = GraphView
