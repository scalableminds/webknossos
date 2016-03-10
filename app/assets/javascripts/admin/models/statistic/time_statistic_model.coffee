### define
underscore : _
backbone : backbone
moment : moment
###

class TimeStatisticModel extends Backbone.Model

  url : "api/statistics/webknossos"

  initialize : ->

    # set defaults
    @set("tracingTimes", new Backbone.Collection([{
      start : moment().startOf("week"),
      end : moment().endOf("week"),
      tracingTime : 0}])
    )


  parse : (response) ->

    timings = _.sortBy(response.tracingTimes, (timeEntry) -> return timeEntry.start)
    response.tracingTimes = new Backbone.Collection(timings)

    return response




