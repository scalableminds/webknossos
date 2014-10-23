### define
underscore : _
backbone : Backbone
moment : moment
###

class LoggedTimeCollection extends Backbone.Collection

  comparator : (model) -> return -model.get("interval")

  url : ->

    if @userID
      return "/api/users/#{@userID}/loggedTime"
    else
      return "/api/user/loggedTime"

  initialize : (models, options) ->

    @userID = options.userID


  parse : (response) ->

    return response.loggedTime.map(
      (entry) ->
        interval = entry.paymentInterval
        return {
          interval : moment("#{interval.year} #{interval.month}", "YYYY MM")
          time: moment.duration(entry.durationInSeconds, "seconds")
        }
    )


