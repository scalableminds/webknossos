### define
underscore : _
app : app
backbone.marionette : marionette
d3: d3
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

    dates = @model.get("tracingTimes").map((item) -> return moment(item.get("start")).format("YYYY-MM-DD"))
    weeklyHours = @model.get("tracingTimes").map((item) -> return parseInt moment.duration(item.get("tracingTime")).asHours())

    # c3 doesn't support AMD as of yet so we need this hack for it to load d3 properly
    window.d3 = d3
    require(["c3"], (c3) =>

      graph = c3.generate(
        bindto : "#graph"
        data:
          x: "date"
          columns: [
            ["date"].concat(dates)
            ["WeeklyHours"].concat(weeklyHours)
          ]
          selection :
            enabled : true
            grouped : false
            multiple : false
        axis :
          x :
            type : "timeseries"
          y :
            label : "hours / week"
        legend :
          show : false
        point :
          onclick : @selectDataPoint
      )
    )

  selectDataPoint : (data) ->

    app.vent.trigger("graphView:updatedSelection", data)
