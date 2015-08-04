### define
underscore : _
backbone : backbone
moment : moment
###

class TimeStatisticModel extends Backbone.Model

  url : "api/statistics/webknossos"

  initialize : ->

    @listenTo(@, "sync", =>
      times = @get("tracingTimes")
      @set("tracingTimes", new Backbone.Collection(times))
    )

  parse : (response) ->

    if _.isEmpty(response.tracingTimes)
      response.tracingTimes.push(
        start : moment().startOf("week")
        end : moment().endOf("week")
        tracingTime : 0
      )
    else
      # deliberately ignore the last aka current month, since the data is not
      # yet complete
      response.tracingTimes = _.chain(response.tracingTimes)
        .sortBy((timeEntry) -> return timeEntry.start)
        .slice(0, -1)
        .value()

    return response




