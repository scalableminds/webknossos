### define
underscore : _
backbone : backbone
###

class TimeStatisticModel extends Backbone.Model

  url : "api/statistics/oxalis"

  parse : (response) ->

    tracingTime = response.tracingTime
    response.tracingTime = new backbone.Collection(tracingTime)
    return response



