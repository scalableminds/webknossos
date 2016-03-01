_          = require("lodash")
app        = require("app")
Marionette = require("backbone.marionette")
c3         = require("c3")
moment     = require("moment")

class GraphView extends Marionette.ItemView

  template : _.template("""
    <h3>Overall Weekly Tracing Time</h3>
    <div id="graph"></div>
  """)


  initialize : ->

    @listenTo(@, "show", @addGraph)


  addGraph : ->


    dates = @model.get("tracingTimes").map((item) -> return moment(item.get("start")).format("YYYY-MM-DD"))
    weeklyHours = @model.get("tracingTimes").map((item) -> return moment.duration(item.get("tracingTime")).asHours())

    graph = c3.generate(
      bindto : "#graph"
      data:
        x: "date"
        columns: [
          ["date"].concat(dates)
          ["weeklyHours"].concat(weeklyHours)
        ]
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
