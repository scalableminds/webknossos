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

    return response




