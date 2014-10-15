### define
underscore : _
app : app
backbone.marionette : marionette
c3: c3
moment : moment
###

class GraphView extends Backbone.Marionette.ItemView

  template : _.template("""
    <h3>Overall Weekly Tracing Time</h3>
    <div id="graph"></div>
  """)


  initialize : ->

    @listenTo(@, "show", @addGraph)


  addGraph : ->

    dates = @map((item) -> return item.interval
    monthlyMinutes = @model.get("tracingTimes").map((item) -> return parseInt moment.duration(item.get("tracingTime")).asHours())

    graph = c3.generate(
      bindto : "#graph"
      data:
        x: "date"
        columns: [
          ["date"].concat(dates)
          ["monthlyMinutes"].concat(monthlyMinutes)
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
