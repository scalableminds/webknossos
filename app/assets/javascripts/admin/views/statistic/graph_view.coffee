### define
underscore : _
app : app
backbone.marionette : marionette
c3 : c3
moment : moment
admin/models/statistic/time_statistic_collection : TimeStatisticCollection
###

class GraphView extends Backbone.Marionette.ItemView

  template : _.template("""
  """)

  initialize : ->


    @model = new TimeStatisticCollection().fetch(
      data : "interval=week"
    ).done(=>
      @collection = @model.get("tracingTime")
      @collection.fetch().done(=>
        @update()
      )
    )

    @listenTo(@collection, "reset", @update)

  update : ->

    dates = @collection.map((item) -> return moment(item.get("start")).format("YYYY-MM-DD"))
    weeklyHours = @collection.map((item) -> return moment(item.get("tracingTime")).format("hh"))

    graph = c3.generate(
      bindto : ".graph"
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