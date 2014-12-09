### define
underscore : _
backbone : Backbone
format_utils : FormatUtils
###

class LoggedTimeModel extends Backbone.Model

  urlRoot : ->

    if userID = @get("userID")
      return "/api/users/#{userID}/loggedTime"
    else
      return "/api/user/loggedTime"


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
        interval : interval.year + "-" + (if interval.month < 10 then "0" else "") + interval.month
        months: interval.year * 12 + interval.month
      }
    ).sort( (a, b) -> b.months - a.months )

