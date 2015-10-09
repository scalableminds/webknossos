_        = require("lodash")
backbone = require("backbone")
moment   = require("moment")

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

    # deliberately ignore the last aka current month, since the data is not
    # yet complete
    timings = response.tracingTimes
    if timings.length > 1

      timings = _.chain(response.tracingTimes)
        .sortBy((timeEntry) -> return timeEntry.start)
        .slice(0, -1)
        .value()

    response.tracingTimes = new Backbone.Collection(timings)

    return response

module.exports = TimeStatisticModel


