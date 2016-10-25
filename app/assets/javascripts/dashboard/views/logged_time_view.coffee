_                    = require("lodash")
Marionette           = require("backbone.marionette")
c3                   = require("c3")
LoggedTimeListView   = require("./logged_time_list_view")
LoggedTimeCollection = require("../models/logged_time_collection")


class LoggedTimeView extends Marionette.View

  template : _.template("""
    <h3>Tracked Time</h3>
    <div class="row">
      <div class="col-sm-10">
        <div id="time-graph"></div>
      </div>
      <div class="col-sm-2">
        <div class="time-table"></div>
      </div>
      <% if (items.length == 0) { %>
        <h4>Sorry. We don't have any time logs for you. Trace something and come back later</h4>
      <% } %>
    </div>
  """)

  regions :
    "timeTable" : ".time-table"


  initialize : (options) ->

    @collection = new LoggedTimeCollection([], userID : @options.userID)
    @listenTo(@collection, "sync", @render)
    @collection.fetch()


  onRender : ->

    if @collection.length > 0
      @showChildView("timeTable", new LoggedTimeListView({@collection}))
      _.defer( => @addGraph())


  addGraph : ->

    # Only render the chart if we have any data.
    if @collection.length > 0

      dates = @collection.map((item) -> return item.get("interval").toDate())
      monthlyHours = @collection.map((item) -> return item.get("time").asHours())

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


  serializeData : ->

    return items: @serializeCollection(@collection)

module.exports = LoggedTimeView
