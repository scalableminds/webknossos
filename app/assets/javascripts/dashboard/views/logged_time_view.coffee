### define
underscore : _
backbone.marionette : marionette
c3 : c3
dashboard/views/logged_time_list_view : LoggedTimeListView
dashboard/models/logged_time_collection : LoggedTimeCollection
###

class LoggedTimeView extends Backbone.Marionette.LayoutView

  template : _.template("""
    <h3>Tracked Time</h3>
    <div class="row-fluid">
      <div class="col-sm-10">
        <div id="time-graph"></div>
      </div>
      <div class="col-sm-2">
        <div class="time-table"></div>
      </div>
    </div>
  """)

  regions :
    "timeTable" : ".time-table"


  initialize : (options) ->


    @collection = new LoggedTimeCollection([], userID : @options.userID)
    @listenTo(@collection, "sync", @addGraph)
    @collection.fetch()


  onRender : ->

    @timeTable.show(new LoggedTimeListView({@collection}))
    if @collection.length > 0
      _.defer( => @addGraph())


  addGraph : ->

    dates = @collection.map((item) -> return item.get("interval").toDate())
    monthlyHours = @collection.map((item) -> return parseInt item.get("time").asHours())

    graph = c3.generate(
      bindto : "#time-graph" #doesn't work with classes
      data:
        x: "date"
        columns: [
          ["date"].concat(dates)
          ["monthlyHours"].concat(monthlyHours)
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

