### define
underscore : _
app : app
backbone.marionette : marionette
c3 : c3
moment : moment
admin/models/statistic/time_statistic_model : TimeStatisticModel
###

class GraphView extends Backbone.Marionette.ItemView

  template : _.template("""
    <h3>Overall Weekly Tracing Time</h3>
    <div id="graph"></div>
  """)

  initialize : ->

    @model = new TimeStatisticModel()
    @listenTo(@model, "sync", @update)

    @model.fetch(
      data : "interval=week"
    )


  update : ->

    dates = @model.get("tracingTimes").map((item) -> return moment(item.get("start")).format("YYYY-MM-DD"))
    weeklyHours = @model.get("tracingTimes").map((item) -> return parseInt moment.duration(item.get("tracingTime")).asHours())

    graph = c3.generate(
      bindto : "#graph"
      data:
        x: "x"
        columns: [
          ["x"].concat(dates)
          ["WeeklyHours"].concat(weeklyHours)
        ]
        selection :
          enabled : true
          grouped : false
      axis :
        x :
          type : "timeseries"
      legend :
        show : false
      point :
        onclick : @selectDataPoint
    )

  selectDataPoint : (data) ->

    app.vent.trigger("graphView:updatedSelection", data)