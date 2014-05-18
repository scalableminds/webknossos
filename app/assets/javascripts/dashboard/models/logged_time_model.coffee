### define
underscore : _
backbone : Backbone
format_utils : FormatUtils
###

class LoggedTimeModel extends Backbone.Model

  urlRoot : "/api/user/loggedTime"
  defaults :
    formattedLogs : []


  parse : (response) ->

    return {
      formattedLogs : @getFormattedLogs(response.loggedTime)
    }


  getFormattedLogs : (loggedTime) ->

    return loggedTime.map((entry) ->
      interval = entry.paymentInterval
      return {
        time: FormatUtils.formatSeconds(entry.durationInSeconds)
        interval : interval.year + "-" + interval.month
      }
    ).sort( (a, b) -> a.interval > b.interval )

