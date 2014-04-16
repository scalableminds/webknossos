### define
underscore : _
backbone : Backbone
###

class LoggedTimeModel extends Backbone.Model

  urlRoot : "/api/user/loggedTime"

  getFormattedLogs : ->

    loggedTime = @get("loggedTime")

    return loggedTime.map( (entry) ->

      # TODO use momentjs.duration.format()
      # https://github.com/moment/moment/issues/1048
      t = moment.duration(seconds: entry.durationInSeconds)
      [ days, hours, minutes ] = [ t.days(), t.hours(), t.minutes() ]
      interval = entry.paymentInterval

      return {
        time :
          if days == 0 and hours == 0
            "#{minutes}m"
          else if days == 0
            "#{hours}h #{minutes}m"
          else
            "#{days}d #{hours}h #{minutes}m"

        interval : interval.year + "-" + interval.month
      }
    ).sort( (a, b) -> a.interval > b.interval )

