### define
underscore : _
backbone : Backbone
moment : moment
###

class LoggedTimeCollection extends Backbone.Collection

  url : ->

    if userID = @get("userID")
      return "/api/users/#{userID}/loggedTime"
    else
      return "/api/user/loggedTime"


  parse : (response) ->

    return response.loggedTime.map(
      (entry) ->
        interval = entry.paymentInterval
        return {
          time: moment.duration(entry.durationInSeconds, "seconds").asMinutes()
          interval : moment("#{interval.year} #{interval.month}", "YYYY MM")
        }
    ).sort( (a, b) -> a.interval > b.interval )

