### define
underscore : _
backbone : backbone
###

class TimeStatisticModel extends Backbone.Model

  url : "api/statistics/oxalis"

  initialize : ->

    @listenTo(@, "sync", =>
      times = @get("tracingTimes")
      @set("tracingTimes", new Backbone.Collection(times))
    )




